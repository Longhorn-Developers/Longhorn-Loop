import { API_BASE_URL } from "@/app/config/api";
import { useOnboarding } from "@/app/context/OnboardingContext";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  NativeSyntheticEvent,
  SafeAreaView,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  TouchableOpacity,
  View,
} from "react-native";

export default function AccountVerification() {
  const router = useRouter();
  const { data, update } = useOnboarding();
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef<(TextInput | null)[]>([]);

  const allFilled = code.every((digit) => digit !== "");

  const handleChange = (text: string, index: number) => {
    const newCode = [...code];
    newCode[index] = text.slice(-1);
    setCode(newCode);
    setError("");

    // Auto-advance to next input
    if (text && index < 5) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    e: NativeSyntheticEvent<TextInputKeyPressEventData>,
    index: number,
  ) => {
    if (e.nativeEvent.key === "Backspace" && !code[index] && index > 0) {
      inputs.current[index - 1]?.focus();
    }
  };

  const handleVerify = async () => {
    if (!allFilled || loading) return;

    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE_URL}/auth/verify-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: data.email,
          code: code.join(""),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === "INVALID_CODE") {
          setError("Incorrect code. Please try again.");
          setCode(["", "", "", "", "", ""]);
          inputs.current[0]?.focus();
        } else if (result.error === "CODE_EXPIRED") {
          setError("Code has expired. Please request a new one.");
        } else if (result.error === "TOO_MANY_ATTEMPTS") {
          setError("Too many attempts. Please request a new code.");
        } else if (result.error === "CODE_NOT_FOUND") {
          setError("No verification code found. Please request a new one.");
        } else if (result.error === "INVALID_UT_EMAIL") {
          setError("Please use a valid @utexas.edu email address.");
        } else {
          setError(result.error || "Something went wrong. Please try again.");
        }
        return;
      }

      // Store the JWT token and navigate to onboarding
      if (result.token) {
        update({ token: result.token });
      }
      router.push("/CreateAccount");
    } catch (err: any) {
      console.error("Verify error:", err);
      setError(`Debug: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (resending) return;

    setResending(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE_URL}/auth/resend-code`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: data.email }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.error === "RESEND_TOO_SOON") {
          setError("Please wait before requesting a new code.");
        } else if (result.error === "INVALID_UT_EMAIL") {
          setError("Please use a valid @utexas.edu email address.");
        } else {
          setError(result.error || "Failed to resend code. Please try again.");
        }
        return;
      }

      // Clear inputs for new code
      setCode(["", "", "", "", "", ""]);
      inputs.current[0]?.focus();
    } catch (err) {
      setError("Network error. Please check your connection.");
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-white">
      <View className="flex-1 px-6 pt-4">
        {/* Back Arrow */}
        <TouchableOpacity
          onPress={() => router.back()}
          className="mb-8 self-start"
        >
          <Text className="text-2xl text-gray-800">←</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text className="text-2xl font-bold text-gray-900 mb-2">
          Account Verification
        </Text>
        <Text className="text-sm text-gray-500 mb-8">
          We've sent a verification code to{"\n"}
          <Text className="font-semibold text-gray-700">{data.email}</Text>
        </Text>

        {/* Code Input Boxes */}
        <View className="flex-row justify-center gap-3 mb-4">
          {code.map((digit, index) => (
            <TextInput
              key={index}
              ref={(ref) => {
                inputs.current[index] = ref;
              }}
              style={{
                width: 48,
                height: 56,
                borderWidth: 1,
                borderRadius: 8,
                textAlign: "center",
                fontSize: 20,
                fontWeight: "600",
                borderColor: error ? "#EF4444" : digit ? "#9CA3AF" : "#D1D5DB",
              }}
              value={digit}
              onChangeText={(text) => handleChange(text, index)}
              onKeyPress={(e) => handleKeyPress(e, index)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
            />
          ))}
        </View>

        {/* Error Message */}
        {error ? (
          <Text className="text-red-500 text-sm text-center mb-4">{error}</Text>
        ) : (
          <View className="mb-4" />
        )}

        {/* Verify Button */}
        <TouchableOpacity
          className={`rounded-lg py-4 items-center justify-center mb-4 ${
            allFilled && !loading
              ? "bg-orange-700"
              : "bg-transparent border border-gray-300"
          }`}
          onPress={handleVerify}
          activeOpacity={allFilled ? 0.8 : 1}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text
              className={`text-base font-semibold ${allFilled ? "text-white" : "text-gray-400"}`}
            >
              Verify
            </Text>
          )}
        </TouchableOpacity>

        {/* Resend Code */}
        <View className="flex-row justify-center mt-2">
          <Text className="text-sm text-gray-500">
            Didn't receive the code?{" "}
          </Text>
          <TouchableOpacity onPress={handleResend}>
            <Text className="text-sm text-orange-700 font-semibold">
              {resending ? "Sending..." : "Resend Code"}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
