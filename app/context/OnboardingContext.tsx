import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { API_BASE_URL } from '@/app/config/api';
import { clearSession, loadSession, markOnboardingComplete, saveSession } from '@/app/lib/session';

interface OnboardingData {
  // Auth
  email: string;
  firstName: string;
  lastName: string;
  token: string;

  // Profile
  selectedMajors: string[];
  selectedYear: string;
  uniqueClassification: string[];

  // Interests
  selectedTags: string[];

  // Avatar
  avatar: number | null;
}

interface OnboardingContextType {
  data: OnboardingData;
  update: (partial: Partial<OnboardingData>) => void;
  reset: () => void;
  /**
   * True until the stored session has been read off disk.
   *
   * Anything that decides "signed in or not" MUST wait for this. Reading it
   * too early gives you `token: ''` for a user who is perfectly signed in,
   * which is how you get a one-frame flash of the sign-in screen — or worse, a
   * redirect away from the app.
   */
  isHydrating: boolean;
  /**
   * Cached `users.onboarding_completed` for the restored session.
   *
   * Only meaningful once `isHydrating` is false, and only for a session that
   * came off disk — the launch gate reads it to decide between the feed and
   * resuming onboarding.
   */
  onboardingComplete: boolean;
  /** Record that onboarding finished (or that /users/me says it did). */
  setOnboardingComplete: (complete: boolean) => void;
}

const DEFAULT_DATA: OnboardingData = {
  email: '',
  firstName: '',
  lastName: '',
  token: '',
  selectedMajors: [],
  selectedYear: '',
  uniqueClassification: [],
  selectedTags: [],
  avatar: null,
};

const OnboardingContext = createContext<OnboardingContextType>({
  data: DEFAULT_DATA,
  update: () => {},
  reset: () => {},
  isHydrating: true,
  onboardingComplete: false,
  setOnboardingComplete: () => {},
});

/**
 * Holds the in-flight onboarding answers AND the signed-in session.
 *
 * Those are two jobs in one provider, which is not ideal — but the token has
 * lived here since onboarding was the only way to get one, and every screen
 * already reads it as `useOnboarding().data.token`. Splitting it is a separate
 * refactor; making it survive a restart is not.
 *
 * The token is now mirrored to secure storage on write and read back on mount.
 * Everything else here stays in memory on purpose: half-finished onboarding
 * answers are not worth restoring, and restoring them would resume someone
 * three screens into a flow they abandoned.
 */
export function OnboardingProvider({ children }: { children: React.ReactNode }) {
  const [data, setData] = useState<OnboardingData>(DEFAULT_DATA);
  const [isHydrating, setIsHydrating] = useState(true);
  const [onboardingComplete, setOnboardingCompleteState] = useState(false);

  // Rehydrate once, at mount.
  useEffect(() => {
    let cancelled = false;

    loadSession()
      .then((session) => {
        if (cancelled || !session) return;
        setData((prev) => ({ ...prev, token: session.token, email: session.email }));
        setOnboardingCompleteState(session.onboardingComplete);
        // Deliberately NOT awaited: the launch gate only needs the token, and
        // making it wait on a network round trip would put a blank screen in
        // front of every cold start — including offline ones, where it would
        // never resolve.
        void refreshFromServer(session.token);
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });

    /**
     * Fill in what storage doesn't hold, once we're already inside the app.
     *
     * Only the token and email are persisted. The display name is not, so
     * without this the header greets a restored user as "User" — `home.tsx`
     * reads `data.firstName`, which is empty until something puts it back.
     *
     * This also re-checks `onboarding_completed` against the server, which is
     * the point at which the cached flag gets corrected if it ever drifts
     * (a profile finished on another device, say).
     */
    async function refreshFromServer(token: string): Promise<void> {
      try {
        const res = await fetch(`${API_BASE_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        // Two ways a stored session can be dead, and both have to be dropped
        // rather than carried into the app.
        //
        //   401 — the token itself is rejected: expired past what the local
        //         exp check caught, or signed with a since-rotated secret.
        //   404 — USER_NOT_FOUND. The token is perfectly valid and the user
        //         row behind it is gone. Happens when an account is deleted
        //         from another device, or when the database is reset under a
        //         live session.
        //
        // The 404 case is the nastier of the two to leave in place: the app
        // looks signed in, so every screen renders and then fails on its own,
        // and Settings fails too — which is where Log Out lives. There is no
        // way out from inside the UI. Clearing here is the escape hatch.
        if (res.status === 401 || res.status === 404) {
          if (!cancelled) reset();
          return;
        }

        if (!res.ok || cancelled) return;

        const body = (await res.json()) as {
          user?: { first_name?: string; last_name?: string; onboarding_completed?: unknown };
        };
        if (cancelled || !body.user) return;

        setData((prev) => ({
          ...prev,
          firstName: body.user?.first_name || prev.firstName,
          lastName: body.user?.last_name || prev.lastName,
        }));

        const completed = Boolean(body.user.onboarding_completed);
        setOnboardingCompleteState(completed);
        void markOnboardingComplete(completed);
      } catch {
        // Offline, or the Worker is down. The session stays valid and the
        // greeting stays generic until the next launch — not worth signing
        // anyone out over.
      }
    }

    return () => {
      cancelled = true;
    };
    // reset is defined below and stable; including it would need a reorder
    // that buys nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setOnboardingComplete = useCallback((complete: boolean) => {
    setOnboardingCompleteState(complete);
    void markOnboardingComplete(complete);
  }, []);

  const update = useCallback((partial: Partial<OnboardingData>) => {
    setData((prev) => {
      const next = { ...prev, ...partial };

      // Mirror to storage whenever a token arrives or changes. Deliberately
      // fire-and-forget: sign-in must not block on a keychain write, and
      // saveSession swallows its own failures.
      if (partial.token !== undefined && partial.token !== prev.token) {
        if (partial.token) {
          // onboardingComplete starts false and is corrected the moment we
          // hear from /users/me — a brand-new account genuinely has not
          // onboarded yet, and guessing true would drop them on an empty feed.
          void saveSession({ token: next.token, email: next.email, onboardingComplete: false });
        } else {
          void clearSession();
        }
      }

      return next;
    });
  }, []);

  /**
   * Log Out and account deletion both land here.
   *
   * Clearing storage is part of the reset, not something callers have to
   * remember separately — a "log out" that leaves the token on disk hands the
   * account back on the next launch, and that bug is invisible in testing
   * because the in-memory state looks correct.
   */
  const reset = useCallback(() => {
    setData(DEFAULT_DATA);
    setOnboardingCompleteState(false);
    void clearSession();
  }, []);

  return (
    <OnboardingContext.Provider
      value={{ data, update, reset, isHydrating, onboardingComplete, setOnboardingComplete }}
    >
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding() {
  return useContext(OnboardingContext);
}
