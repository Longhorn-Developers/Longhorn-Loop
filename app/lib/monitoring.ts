/**
 * Crash reporting — currently a NO-OP. Nothing is reported anywhere.
 *
 * WHY IT IS STUBBED
 *
 * @sentry/react-native 7.2.0 pulls in @sentry/react 10.x, whose ESM build
 * Metro cannot resolve: bundling fails with
 *
 *   Unable to resolve "./profiler.js" from
 *   node_modules/@sentry/react/build/esm/index.js
 *
 * even though that file exists on disk — it is a package-exports resolution
 * problem, not a broken install. It broke `expo start` outright, so the SDK
 * was removed rather than debugged under time pressure.
 *
 * MY EARLIER ASSUMPTION WAS WRONG, and it is worth writing down so the next
 * attempt does not repeat it. The previous version of this file loaded Sentry
 * through a `require()` inside a try/catch, on the theory that a missing or
 * broken SDK would be caught at runtime. It will not be. Metro resolves every
 * require at BUILD time, so an unresolvable module fails the bundle before any
 * try/catch exists to catch anything. A guarded require protects against a
 * module that throws on import; it does nothing for a module that cannot be
 * resolved.
 *
 * WHEN PICKING THIS BACK UP
 *
 *   1. Reinstall, and check the bundle actually builds before writing any
 *      integration code: `npx expo start --clear` and wait for it to finish.
 *   2. If it fails the same way, the usual fix is enabling package exports in
 *      metro.config.js (`config.resolver.unstable_enablePackageExports = true`),
 *      but note this repo already has a custom resolveRequest for
 *      react-native-maps on web, so test both platforms after changing it.
 *   3. Pinning @sentry/react-native to a 6.x release is the other way out, and
 *      probably the faster one.
 *
 * The call sites stay as they are. They are already written, they cost nothing
 * while this is a stub, and leaving them means turning reporting back on is a
 * change to this file alone.
 */

/** No-op. See the note above. */
export function initMonitoring(): void {}

/**
 * No-op. Kept so the catch sites that call it — onboarding.submit is the one
 * that matters — do not have to be edited twice.
 */
export function captureError(_where: string, _error: unknown): void {}

/** Always false while this is stubbed. */
export function isMonitoringEnabled(): boolean {
  return false;
}
