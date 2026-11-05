import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { useThemeColors } from '@/app/lib/themeColors';
import { UT_EMAIL_ERROR } from '@/shared/utEmail';
import { RESEND_COOLDOWN_MS } from '@/shared/verificationCode';
import InlineAlert from '../components/alerts/InlineAlert';
import PrimaryButton from '../components/buttons/PrimaryButton';
import OtpInput from '../components/inputs/OtpInputField';
import FlowLayout from '../components/layouts/FlowLayout';

/** A retryAfterMs from the server or a route param, as a non-negative number. */
function parseRetryAfterMs(value: unknown): number {
  const ms = Number(value);
  return Number.isFinite(ms) && ms > 0 ? ms : 0;
}

export default function AccountVerification() {
  const router = useRouter();
  // retryAfterMs: how long Resend stays locked, from whoever sent the code
  // before pushing here — the full cooldown after a successful send, or the
  // server's figure when their send came back RESEND_TOO_SOON.
  const params = useLocalSearchParams<{ sent?: string; retryAfterMs?: string }>();
  const colors = useThemeColors();
  const { data, update, setOnboardingComplete } = useOnboarding();
  const [code, setCode] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  // Starts true only when this screen is the one that has to send the code.
  // LoginPage and RegisterPage both send it themselves and arrive with ?sent=1
  // — firing a second /auth/send-code here would immediately trip the
  // cooldown that the first request just started.
  const [sendingInitialCode, setSendingInitialCode] = useState(params.sent !== '1');
  // Resend cooldown as a DEADLINE, not a counter. The cooldown is keyed on the
  // email server-side, so it is usually already running before this screen
  // mounts — hence seeding from the route param rather than starting at 0.
  //
  // Counting down a number (setInterval → s - 1) drifts in exactly the flow
  // this screen exists for: the user switches to Mail to find the code, iOS
  // suspends JS timers while the app is backgrounded, and they come back to a
  // countdown that resumes where it paused while the server's window has
  // already closed. Reading the wall clock on each tick self-corrects on the
  // first tick after resume.
  //
  // `now` lives in the same state as `until` so both come from one Date.now():
  // computed separately, a few ms between them rounds 30000 up to 31s.
  const [cooldown, setCooldown] = useState(() => {
    const now = Date.now();
    return { now, until: now + parseRetryAfterMs(params.retryAfterMs) };
  });
  const cooldownUntil = cooldown.until;
  const cooldownSec = Math.max(0, Math.ceil((cooldownUntil - cooldown.now) / 1000));
  const codeInput = useRef<TextInput>(null);
  const hasSentInitialCode = useRef(params.sent === '1');

  const allFilled = code.every((digit) => digit !== '');

  // One interval per deadline, keyed on the deadline alone (not the whole
  // object, which changes every tick). It stops itself once the deadline
  // passes, and a new deadline replaces it through the cleanup.
  useEffect(() => {
    if (cooldownUntil <= Date.now()) return;
    const id = setInterval(() => {
      const now = Date.now();
      setCooldown((c) => ({ ...c, now }));
      if (now >= cooldownUntil) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
  }, [cooldownUntil]);

  const startCooldown = (retryAfterMs: unknown) => {
    const now = Date.now();
    setCooldown({ now, until: now + parseRetryAfterMs(retryAfterMs) });
  };

  // A RESEND_TOO_SOON from the server. Normally it says how long is left and
  // the countdown is the whole answer. But a Worker deployed before LOOP-302
  // sends a bare { error } with a longer cooldown than this client assumes, so
  // without a fallback the tap was silently ignored: no countdown (nothing to
  // count from), no message, nothing sent. The app and the Worker ship
  // separately, so this mismatch is real for as long as either side lags.
  const handleTooSoon = (retryAfterMs: unknown) => {
    if (parseRetryAfterMs(retryAfterMs) > 0) {
      startCooldown(retryAfterMs);
      return;
    }
    setError('A code was sent moments ago. Please wait a little before requesting another.');
    startCooldown(RESEND_COOLDOWN_MS);
  };

  useEffect(() => {
    if (hasSentInitialCode.current || !data.email) {
      setSendingInitialCode(false);
      return;
    }
    hasSentInitialCode.current = true;

    const sendInitialCode = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/auth/send-code`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });

        const result = await res.json();

        if (!res.ok) {
          if (result.error === 'RESEND_TOO_SOON') {
            // Previously an empty branch. A code IS already on its way, so
            // this is not an error state — but saying nothing left the screen
            // claiming "We've sent a verification code" while this request
            // sent nothing, with a Resend button that would also fail. Start
            // the countdown so the wait is visible.
            //
            // Only reached when a caller arrives WITHOUT ?sent=1, which none
            // currently do. The LOOP-302 repro (Register → back → Register
            // again) 429s on RegisterPage's own send-code, and is handled
            // there by forwarding the server's retryAfterMs as a param.
            handleTooSoon(result.retryAfterMs);
          } else if (result.error === 'INVALID_UT_EMAIL') {
            setError(UT_EMAIL_ERROR);
          } else {
            // Never render result.error directly — it is a machine code like
            // MISSING_FIELDS, and testers were seeing it verbatim.
            setError('Failed to send verification code. Please try again.');
          }
        }
      } catch (_err) {
        setError('Network error. Please check your connection.');
      } finally {
        setSendingInitialCode(false);
      }
    };

    sendInitialCode();
  }, [data.email]);

  const handleCodeChange = (next: string[]) => {
    setCode(next);
    setError('');
  };

  const handleVerify = async () => {
    if (!allFilled || loading) return;

    setLoading(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: data.email,
          code: code.join(''),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === 'INVALID_CODE') {
          setError('Incorrect code. Please try again.');
          setCode(['', '', '', '', '', '']);
          codeInput.current?.focus();
        } else if (result.error === 'CODE_EXPIRED') {
          setError('Code has expired. Please request a new one.');
        } else if (result.error === 'TOO_MANY_ATTEMPTS') {
          setError('Too many attempts. Please request a new code.');
        } else if (result.error === 'CODE_NOT_FOUND') {
          setError('No verification code found. Please request a new one.');
        } else if (result.error === 'INVALID_UT_EMAIL') {
          setError(UT_EMAIL_ERROR);
        } else {
          setError('Something went wrong. Please try again.');
        }
        return;
      }

      const token = result.token;
      if (token) {
        // This is what persists the session — update() mirrors a new token to
        // secure storage, so the next cold start skips all of this.
        update({ token });
      }

      try {
        const profileRes = await fetch(`${API_BASE_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (profileRes.ok) {
          const profileData = await profileRes.json();
          if (profileData.user?.onboarding_completed) {
            update({
              firstName: profileData.user.first_name || '',
              lastName: profileData.user.last_name || '',
            });
            // Cache it so the launch gate can route straight to the feed
            // without waiting on a network call.
            setOnboardingComplete(true);
            router.replace('/(tabs)/home');
            return;
          }
        }
      } catch {
        // If profile check fails, fall through to onboarding
      }

      router.push('/CreateAccount');
    } catch (_err) {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending || cooldownSec > 0) return;

    setResending(true);
    setError('');

    try {
      const res = await fetch(`${API_BASE_URL}/auth/resend-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: data.email }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === 'RESEND_TOO_SOON') {
          // Usually no message — the button shows the remaining seconds,
          // which is the answer to "wait how long?". See handleTooSoon for
          // when the server can't say.
          handleTooSoon(result.retryAfterMs);
        } else if (result.error === 'INVALID_UT_EMAIL') {
          setError(UT_EMAIL_ERROR);
        } else {
          setError('Failed to resend code. Please try again.');
        }
        return;
      }

      setCode(['', '', '', '', '', '']);
      codeInput.current?.focus();
      // A fresh code was just issued, so the server's cooldown restarts now.
      startCooldown(RESEND_COOLDOWN_MS);
    } catch (_err) {
      setError('Network error. Please check your connection.');
    } finally {
      setResending(false);
    }
  };

  const showAlert = error.length > 0;

  return (
    <FlowLayout
      title="Account Verification"
      subTitle={
        data.email
          ? `We've sent a verification code to ${data.email}.\nEnter the code below.`
          : `We've sent a verification code to your email.\nEnter the code below.`
      }
      onBackPress={() => router.back()}
    >
      {showAlert && (
        <View className="mt-4">
          <InlineAlert message={error} />
        </View>
      )}

      <View className="mt-[42px]">
        <OtpInput
          code={code}
          error={showAlert}
          inputRef={codeInput}
          onChangeCode={handleCodeChange}
        />
      </View>

      {/* Without this the screen showed six empty boxes and nothing else while
          the first code was still being requested. On a slow connection that
          reads as broken, and the natural response — tapping Resend — trips
          the 60-second cooldown the pending request is about to create. */}
      {sendingInitialCode && (
        <View className="mt-4 flex-row items-center justify-center gap-2">
          <ActivityIndicator size="small" color={colors.brand} />
          <Text className="font-['Roboto-Flex'] text-sm text-lhlSecondaryTextGrey">
            Sending your code...
          </Text>
        </View>
      )}

      <View className="mt-[42px]">
        <PrimaryButton
          label="Verify Email"
          isFilled={allFilled && !sendingInitialCode}
          onPress={handleVerify}
          isLoading={loading}
          loadingLabel="Verifying..."
        />
      </View>

      {/* A disabled button showing a number beats an enabled one that fails.
          Before this, the only feedback for the cooldown was "Please wait
          before requesting a new code" with no indication of how long. */}
      <Pressable
        className="mt-4"
        disabled={sendingInitialCode || resending || cooldownSec > 0}
        onPress={handleResend}
        accessibilityRole="button"
        accessibilityState={{ disabled: sendingInitialCode || resending || cooldownSec > 0 }}
        accessibilityLabel={
          cooldownSec > 0
            ? `Resend code, available in ${cooldownSec} seconds`
            : 'Resend verification code'
        }
      >
        {/* All 400 — the accent colour marks the tappable half. */}
        <Text className="text-center font-roboto text-base text-lhlInk">
          {"Didn't receive the code? "}
          {cooldownSec > 0 ? (
            <Text className="font-roboto text-lhlSecondaryTextGrey">
              {`Resend in ${Math.floor(cooldownSec / 60)}:${String(cooldownSec % 60).padStart(2, '0')}`}
            </Text>
          ) : (
            <Text className="font-roboto text-lhlAccent">
              {resending ? 'Sending...' : 'Resend Code'}
            </Text>
          )}
        </Text>
      </Pressable>

      {/* Same destination as the back arrow, deliberately.
          router.back() rather than a route literal because this screen is
          reached from BOTH LoginPage and RegisterPage and they arrive
          identically (`?sent=1`, no flow marker), so there is nothing to
          branch on -- back is the only thing that returns you to the right
          one. What this adds over the arrow is a label: the arrow does not
          say it is how you fix a typo, which is why people were tapping it
          and then not knowing what had happened. */}
      <Pressable
        className="mt-3"
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Change email address"
      >
        <Text className="text-center font-roboto text-sm text-lhlSecondaryTextGrey">
          Wrong email?
        </Text>
      </Pressable>
    </FlowLayout>
  );
}
