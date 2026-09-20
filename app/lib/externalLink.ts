// =====================================================================
// Handing a URL off to the platform browser (LOOP-278).
//
// Two testers on two devices lost the app to the same tap: RSVPing on an
// externally ticketed event ("My Hero Academia in Concert", and a Texas
// Performing Arts event whose RSVP pointed at texasperformingarts.evenue.net)
// froze the app on iPhone and hard-crashed it on iPad. Both surfaces went
// through the same two lines:
//
//     setShowOpenLinkModal(false);
//     await WebBrowser.openBrowserAsync(event.rsvp_url);
//
// Both lines are wrong, for different reasons, and this module exists so
// neither can be written by hand again.
//
// 1. THE PRESENTATION RACE. `setShowOpenLinkModal(false)` is a React state
//    update — the confirm dialog is still a presented UIViewController for the
//    rest of the tick and for the length of its dismissal animation.
//    openBrowserAsync presents SFSafariViewController on the same window, and
//    UIKit will not present onto a controller that is already presenting: on
//    iPhone the request is dropped and the user is left looking at a screen
//    whose dialog has gone and whose browser never arrived (the "freeze"), and
//    on iPad, where the dialog is a form sheet, the attempt raises
//    NSInvalidArgumentException and takes the process with it. So the hand-off
//    must wait until the modal is *actually* gone, which is what
//    useExternalLinkHandoff does.
//
// 2. THE UNGUARDED URL. `rsvp_url` is validated on POST /events/create but NOT
//    in server/src/events/ingest.ts, so scraped rows can hold anything a
//    scraper's regex grabbed — a scheme-less host, a mailto:, a fragment of
//    prose, an empty string. openBrowserAsync rejects on some of those and
//    throws on others, and the call site had no try/catch, so the rejection
//    surfaced as an unhandled promise. shared/externalUrl.ts decides up front
//    whether a value is something we can open at all — it lives in shared/ so
//    it can be unit-tested and so any future write-time normalisation agrees
//    with this guard.
//
// Normalising `rsvp_url` at the point it is *written* (so the stored value is
// already openable) is a Create Event concern and is tracked separately; this
// module is the read-side guard and has to keep working for the rows that are
// already in the database.
// =====================================================================

import { toExternalHttpUrl } from '@/shared/externalUrl';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useRef } from 'react';
import { Linking, Platform } from 'react-native';

export { toExternalHttpUrl };

/**
 * Open a URL that toExternalHttpUrl has already approved.
 *
 * Tries the in-app browser first (it keeps the user one swipe from coming
 * back, which the "Did you RSVP?" follow-up depends on) and falls back to the
 * system browser. Both are wrapped: `openBrowserAsync` rejects with
 * "Another WebBrowser is already being presented" if two taps land close
 * together, and that must not reach the caller as an unhandled rejection.
 *
 * Resolves true if some browser took it, false if nothing did. Never throws.
 */
export async function openExternalUrl(url: string): Promise<boolean> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return true;
  } catch {
    // Fall through to the system browser.
  }
  try {
    await Linking.openURL(url);
    return true;
  } catch {
    return false;
  }
}

/**
 * How long to wait for a modal's dismissal callback before opening anyway.
 *
 * `onDismiss` on React Native's <Modal> is documented iOS-only, and the
 * fallback keeps this from depending on it: if the callback never arrives, the
 * link still opens a beat later instead of the tap doing nothing — which is
 * the failure this whole module exists to remove. Comfortably longer than the
 * ~250ms fade the confirm dialogs use.
 */
const DISMISS_FALLBACK_MS = 700;

export interface ExternalLinkHandoff {
  /**
   * Validate `raw` and queue it. Returns false — having opened nothing — if
   * the value isn't a web address, so the caller can show an error state.
   *
   * On iOS the open is deferred until `flush()` (wire it to the dismissing
   * modal's `onDismiss`) or until DISMISS_FALLBACK_MS has passed. Elsewhere
   * it happens immediately: Android's Modal is a Dialog and the browser is a
   * separate Activity, and on web it is a new tab, so neither platform has
   * the UIKit presentation conflict that forces the wait.
   */
  request: (raw: string | null | undefined) => boolean;
  /** Run the queued open now. Safe to call when nothing is queued. */
  flush: () => void;
  /** Drop the queued open (the user backed out). */
  cancel: () => void;
}

export function useExternalLinkHandoff(options?: {
  /**
   * Fires once the user is back — the in-app browser resolves its promise on
   * dismissal, so this runs when they close it.
   *
   * Anything the caller wants to show on their return, such as the "Did you
   * RSVP?" follow-up, belongs here and NOT beside the request() call. Putting
   * it there would open a React Native <Modal> in the same breath as the
   * browser presentation and rebuild the exact UIViewController collision this
   * module exists to remove.
   *
   * On the Linking.openURL fallback the app is backgrounded rather than
   * covered, so this fires straight away and whatever it shows is waiting when
   * the user switches back. Same outcome, one tick earlier.
   */
  onReturn?: () => void;
  /** Called when no browser would take the URL. */
  onFailure?: (url: string) => void;
}): ExternalLinkHandoff {
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Held in refs so `request`/`flush` stay stable across renders and a
  // re-render between the tap and the dismissal can't strand a stale handler.
  //
  // Writing them in render rather than in an effect is the point, not an
  // oversight: the app can return from the external browser before React has
  // flushed effects, and an effect-assigned ref would still be holding the
  // handler from the render BEFORE the tap. That is the stale-handler bug this
  // whole shape exists to prevent. The latest-ref pattern is what
  // useEffectEvent will replace once it ships in a stable React for RN.
  /* eslint-disable react-hooks/refs -- latest-ref pattern; see above */
  const onReturn = useRef(options?.onReturn);
  onReturn.current = options?.onReturn;
  const onFailure = useRef(options?.onFailure);
  onFailure.current = options?.onFailure;
  /* eslint-enable react-hooks/refs */

  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  const flush = useCallback(() => {
    const url = pending.current;
    if (!url) return;
    // Claim it before awaiting: flush() is reachable from both onDismiss and
    // the fallback timer, and whichever loses must not present a second
    // browser on top of the first.
    pending.current = null;
    clearTimer();
    if (inFlight.current) return;
    inFlight.current = true;

    // openBrowserAsync resolves when the in-app browser is DISMISSED, not when
    // it opens, so this is the user coming back -- which is the only safe
    // moment to put another modal on screen.
    void openExternalUrl(url)
      .then((opened) => {
        if (opened) onReturn.current?.();
        else onFailure.current?.(url);
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, []);

  const cancel = useCallback(() => {
    pending.current = null;
    clearTimer();
  }, []);

  const request = useCallback(
    (raw: string | null | undefined) => {
      const url = toExternalHttpUrl(raw);
      if (!url) return false;

      pending.current = url;
      if (Platform.OS !== 'ios') {
        flush();
        return true;
      }
      clearTimer();
      timer.current = setTimeout(flush, DISMISS_FALLBACK_MS);
      return true;
    },
    [flush],
  );

  // Leaving the screen mid-hand-off shouldn't fire a timer into an unmounted
  // component tree.
  useEffect(() => clearTimer, []);

  return { request, flush, cancel };
}
