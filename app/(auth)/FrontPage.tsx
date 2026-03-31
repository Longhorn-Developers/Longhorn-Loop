import { useRouter } from "expo-router";
import React from "react";
import { Pressable, SafeAreaView, ScrollView, Text, View } from "react-native";

export default function FrontPage() {
  const router = useRouter();

  return (
    <SafeAreaView className="flex-1 bg-white">
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}
        className="px-8"
      >
        {/* Title */}
        <Text className="text-3xl font-bold text-center mb-2">
          Welcome to Longhorn Loop
        </Text>
        <Text className="text-center text-gray-500 mb-10">
          The UT platform to...
        </Text>

        {/* Flow Section */}
        <View className="items-center mb-10 gap-4">
          {/* Step 1 */}
          <View className="flex-row items-center gap-4">
            <View className="w-12 h-12 bg-gray-300 rounded" />
            <Text className="text-sm text-gray-700">
              Find Events & Organizations
            </Text>
          </View>

          <Text className="text-gray-400">↓</Text>

          {/* Step 2 */}
          <View className="flex-row items-center gap-4">
            <View className="w-12 h-12 bg-gray-300 rounded" />
            <Text className="text-sm text-gray-700">Make Connections</Text>
          </View>

          <Text className="text-gray-400">↓</Text>

          {/* Step 3 */}
          <View className="flex-row items-center gap-4">
            <View className="w-12 h-12 bg-gray-300 rounded" />
            <Text className="text-sm text-gray-700">Join A Community</Text>
          </View>

          <Text className="text-gray-400">↓</Text>

          {/* Step 4 */}
          <View className="flex-row items-center gap-4">
            <View className="w-12 h-12 bg-gray-300 rounded" />
            <Text className="text-sm text-gray-700">Grow as a Longhorn!</Text>
          </View>
        </View>

        {/* Get Started Button */}
        <Pressable
          className="bg-orange-700 py-4 rounded-lg items-center mb-3"
          onPress={() => router.push("/RegisterPage")}
        >
          <Text className="text-white font-semibold text-base">
            Get Started
          </Text>
        </Pressable>

        {/* Already Have an Account */}
        <Pressable
          className="border border-gray-300 py-4 rounded-lg items-center"
          onPress={() => router.push("/LoginPage")}
        >
          <Text className="text-gray-700 text-base">
            Already Have an Account
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}
