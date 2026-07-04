import { API_BASE_URL } from "@/app/config/api";
import { useOnboarding } from "@/app/context/OnboardingContext";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import {
  NativeSyntheticEvent,
  Pressable,
  Text,
  TextInput,
  TextInputKeyPressEventData,
  View
} from "react-native";
import InlineAlert from "../components/alerts/InlineAlert";
import PrimaryButton from "../components/buttons/PrimaryButton";
import OtpInput from "../components/inputs/OtpInputField";
import FlowLayout from "../components/layouts/FlowLayout";

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
    const cleanText = text.replace(/[^0-9]/g, '');

    if (text.length > 0 && cleanText.length === 0) {
      return;
    }

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

  const showAlert = error.length > 0;

  
   // {/* Verify Button */}
  //       <TouchableOpacity
  //         className={`rounded-lg py-4 items-center justify-center mb-4 ${
  //           allFilled && !loading
  //             ? "bg-orange-700"
  //             : "bg-transparent border border-gray-300"
  //         }`}
  //         onPress={handleVerify}
  //         activeOpacity={allFilled ? 0.8 : 1}
  //       >
  //         {loading ? (
  //           <ActivityIndicator color="#fff" />
  //         ) : (
  //           <Text
  //             className={`text-base font-semibold ${allFilled ? "text-white" : "text-gray-400"}`}
  //           >
  //             Verify
  //           </Text>
  //         )}
  //       </TouchableOpacity>

  return (
    <FlowLayout
      title='Account Verification'
      subTitle={`We've sent a verification code to your email.\nEnter the code below.`}
      onBackPress={() => router.back()}
    >

      {showAlert && (
        <View className='mt-4'>
          <InlineAlert
            message={error}
          />
        </View>
      )}

      <View className='mt-[42px]'>
        <OtpInput 
          code={code}
          error={showAlert}
          inputs={inputs}
          handleChange={handleChange}
          handleKeyPress={handleKeyPress}
        />
      </View>

      {/* TODO: Handle Loading State */}
      <View className='mt-[42px]'>
        <PrimaryButton
          label='Verify Email'
          isFilled={allFilled && !loading}
          onPress={handleVerify}
        />
      </View>

      <Pressable className='mt-4' onPress={handleResend}>
        <Text className="font-['Roboto-Flex'] text-base text-center">
          Didn't receive the code?{' '}
          <Text className="font-['Roboto-Flex'] font-semibold text-lhlBurntOrange">
            {resending ? "Sending..." : "Resend Code"}
          </Text>
        </Text>
      </Pressable>

    </FlowLayout>
  );

}
