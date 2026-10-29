/**
 * Verification code resend cooldown (LOOP-302).
 *
 * Lives in shared/ because both sides need the same number. The server
 * enforces it per EMAIL in /auth/send-code and /auth/resend-code. The client
 * needs it after a SUCCESSFUL send, the one case with no 429 to read
 * `retryAfterMs` from: Register and Login send the code themselves and then
 * push the verification screen, and that screen has to know the cooldown is
 * already running or it shows an enabled Resend the server will refuse.
 *
 * Every 429 path still uses the server's `retryAfterMs`, never this constant,
 * because the server knows when the code was really sent (another device, an
 * earlier visit) and the client does not.
 *
 * Was 60s. Dropped to 30: a minute of dead time with nothing on screen
 * explaining it is what made testers tap Resend, hit the cooldown again, and
 * conclude the app was broken. Still long enough to be a real abuse control —
 * the thing that actually fixes the complaint is the visible countdown, not
 * the number.
 */
export const RESEND_COOLDOWN_MS = 30 * 1000;
