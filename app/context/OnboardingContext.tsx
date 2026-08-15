import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
      })
      .finally(() => {
        if (!cancelled) setIsHydrating(false);
      });

    return () => {
      cancelled = true;
    };
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
