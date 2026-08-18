/**
 * Crash reporting.
 *
 * WHY THIS IS NOT JUST `Sentry.init(...)` IN _layout.tsx
 *
 * Two constraints shaped this file, and both are worth knowing before
 * simplifying it.
 *
 * 1. THE SDK IS OPTIONAL AT RUNTIME.
 *
 *    `@sentry/react-native` is a native module. It is present in an EAS build
 *    and absent in a plain `npx expo start` on a machine that has not run
 *    `npx expo install @sentry/react-native` yet. Importing it statically
 *    means the entire app fails to start on that machine — crash reporting
 *    that crashes the app is worse than no crash reporting. Hence the guarded
 *    require and the `enabled` flag: every function here is a no-op when the
 *    module or the DSN is missing, and nothing else in the app has to care.
 *
 * 2. THE DSN IS CONFIG, NOT A SECRET, BUT IT IS STILL NOT COMMITTED.
 *
 *    A Sentry DSN only permits *writing* events, so it is safe in a client
 *    bundle — which is just as well, since anything in `EXPO_PUBLIC_*` ends up
 *    there. It lives in eas.json / .env rather than here so that a fork or a
 *    local build does not silently post crashes into our project.
 *
 * SETUP, once (see also the PR that introduced this file):
 *
 *    npx expo install @sentry/react-native
 *
 * then add the config plugin to app.json — NOT done in this commit, because
 * listing a plugin for a package that is not installed breaks `expo start`
 * for everyone who has not run the install yet:
 *
 *    "plugins": [..., "@sentry/react-native/expo"]
 *
 * then set EXPO_PUBLIC_SENTRY_DSN in eas.json's build profiles.
 *
 * WHAT WE DELIBERATELY DO NOT SEND
 *
 * The privacy policy at loop.longhorndevelopers.org/privacy states that we use
 * no third-party analytics and do not share data with anyone beyond Cloudflare
 * and Resend. Crash reporting is a third party, and Apple's App Privacy
 * questionnaire asks about it directly. So this is configured to report
 * DIAGNOSTICS, not people:
 *
 *   - sendDefaultPii is false, so no IP address and no user identifiers
 *   - we never call Sentry.setUser(), so crashes are not tied to an account
 *   - breadcrumbs from network requests are stripped of their bodies, because
 *     an /auth/send-code body contains a student's email address and a
 *     verification code
 *
 * If any of that is relaxed, the privacy policy and the App Store answers have
 * to change in the same commit. That is not a formality — a mismatch between
 * the two is a rejection, and a rejection costs a review cycle.
 */

type SentryModule = {
  init: (options: Record<string, unknown>) => void;
  captureException: (error: unknown, context?: Record<string, unknown>) => void;
  addBreadcrumb: (breadcrumb: Record<string, unknown>) => void;
};

/**
 * Loaded with require() rather than import so a missing native module is a
 * caught exception instead of a bundler-level failure. Same pattern the server
 * tests use for `node:sqlite`.
 */
let sentry: SentryModule | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  sentry = require('@sentry/react-native') as SentryModule;
} catch {
  sentry = null;
}

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** True only when the SDK is installed AND a DSN was configured. */
let enabled = false;

/**
 * Redact anything that could carry a person's data out of the app.
 *
 * Sentry attaches an HTTP breadcrumb for every fetch. The URL alone is fine —
 * `/auth/send-code` tells us which route failed — but the request and response
 * bodies are not: that endpoint carries a student's email address, and its
 * sibling carries a live verification code. A crash report is a place a code
 * should never appear.
 */
function scrubBreadcrumb(breadcrumb: Record<string, unknown>): Record<string, unknown> | null {
  const data = breadcrumb.data as Record<string, unknown> | undefined;
  if (!data) return breadcrumb;

  const cleaned: Record<string, unknown> = { ...data };
  delete cleaned.body;
  delete cleaned.request_body;
  delete cleaned.response_body;

  // Emails can also arrive inside a URL if a query param is ever added.
  if (typeof cleaned.url === 'string') {
    cleaned.url = cleaned.url.replace(/[\w.+-]+@[\w.-]+/g, '[email]');
  }

  return { ...breadcrumb, data: cleaned };
}

/**
 * Start crash reporting. Safe to call when the SDK is absent or no DSN is set —
 * it simply does nothing, which is the correct behaviour in local development.
 *
 * Call once, as early as possible in the root layout.
 */
export function initMonitoring(): void {
  if (!sentry || !DSN) return;

  try {
    sentry.init({
      dsn: DSN,

      // No IP addresses, no automatically-collected user identifiers.
      sendDefaultPii: false,

      // Every crash, none of the performance sampling. We want to know when
      // the app breaks; we are not doing APM, and traces are the expensive
      // part of the free tier.
      tracesSampleRate: 0,

      // Distinguishes a TestFlight crash from a store crash in the dashboard.
      environment: __DEV__ ? 'development' : 'production',

      // Local runs would otherwise post noise from half-finished features into
      // the same project as real tester crashes.
      enabled: !__DEV__,

      beforeBreadcrumb: (breadcrumb: Record<string, unknown>) => scrubBreadcrumb(breadcrumb),
    });

    enabled = true;
  } catch (err) {
    // A monitoring failure must never take the app down with it.
    console.warn('[monitoring] Sentry failed to initialise:', err);
  }
}

/**
 * Report an error that the app handled but should not have hit.
 *
 * Use this at the `catch` sites that currently only `console.error` — a caught
 * exception is invisible to crash reporting by definition, and those are
 * exactly the failures a tester describes as "it just didn't work". The
 * onboarding submit and the session rehydrate are the two worth wiring first.
 *
 * `where` should name the operation, not the file: "onboarding.submit" reads
 * better in a dashboard than "OnboardingComplete.tsx:104".
 */
export function captureError(where: string, error: unknown): void {
  if (!enabled || !sentry) return;

  try {
    sentry.captureException(error, { tags: { where } });
  } catch {
    // Swallowed on purpose. See above.
  }
}

/** Whether reports are actually being sent. Exposed for a debug screen. */
export function isMonitoringEnabled(): boolean {
  return enabled;
}
