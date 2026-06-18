import { ArrowLeft } from 'phosphor-react-native';
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Image,
  SectionList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { GestureHandlerRootView, Swipeable } from 'react-native-gesture-handler';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';

// ---------- Types ----------

interface Notification {
  id: number;
  user_id: number;
  type: string;
  title: string;
  subtitle: string | null;
  avatar_url: string | null;
  thumbnail_url: string | null;
  event_id: number | null;
  read_at: string | null;
  created_at: string;
}

interface Section {
  title: string;
  data: Notification[];
}

// ---------- Helpers ----------

function relativeTime(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function groupByDate(items: Notification[]): Section[] {
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const weekStart = new Date(todayStart);
  weekStart.setDate(weekStart.getDate() - 7);

  const today: Notification[] = [];
  const yesterday: Notification[] = [];
  const lastWeek: Notification[] = [];

  for (const n of items) {
    const d = new Date(n.created_at);
    if (d >= todayStart) today.push(n);
    else if (d >= yesterdayStart) yesterday.push(n);
    else if (d >= weekStart) lastWeek.push(n);
  }

  const sections: Section[] = [];
  if (today.length) sections.push({ title: 'Today', data: today });
  if (yesterday.length) sections.push({ title: 'Yesterday', data: yesterday });
  if (lastWeek.length) sections.push({ title: 'Last 7 Days', data: lastWeek });
  return sections;
}

// ---------- NotificationRow ----------

function NotificationRow({
  item,
  onDelete,
}: {
  item: Notification;
  onDelete: (id: number) => void;
}) {
  const renderRightActions = () => (
    <TouchableOpacity
      onPress={() => onDelete(item.id)}
      className="bg-red-500 justify-center items-center w-[76px] my-1 mr-2 rounded-xl"
    >
      <Text className="text-white font-bold text-[13px]">Delete</Text>
    </TouchableOpacity>
  );

  return (
    <Swipeable renderRightActions={renderRightActions} overshootRight={false}>
      <View className="flex-row items-center px-5 py-3 bg-lhlBackgroundColor gap-3">
        {item.avatar_url ? (
          <Image
            source={{ uri: item.avatar_url }}
            className="w-10 h-10 rounded-full shrink-0"
          />
        ) : (
          <View className="w-10 h-10 rounded-full shrink-0 bg-[#D9D9D9]" />
        )}

        <View className="flex-1 gap-0.5">
          <Text
            className="text-sm font-bold text-[#020B12] leading-5"
            numberOfLines={2}
          >
            {item.title}
          </Text>
          {item.subtitle ? (
            <Text
              className="text-[13px] text-[#9A9A9A] leading-[18px]"
              numberOfLines={1}
            >
              {item.subtitle}
            </Text>
          ) : null}
          <Text className="text-xs text-[#C7C5C5] leading-4">
            {relativeTime(item.created_at)}
          </Text>
        </View>

        {item.thumbnail_url ? (
          <Image
            source={{ uri: item.thumbnail_url }}
            className="w-14 h-14 rounded-lg shrink-0"
          />
        ) : (
          <View className="w-14 h-14 rounded-lg shrink-0 bg-[#D9D9D9]" />
        )}
      </View>
    </Swipeable>
  );
}

// ---------- Main Screen ----------

export default function NotificationsScreen() {
  const router = useRouter();
  const { data } = useOnboarding();

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [toastVisible, setToastVisible] = useState(false);

  const pendingDeleteRef = useRef<{ id: number; item: Notification } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    fetchNotifications();

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        const pending = pendingDeleteRef.current;
        if (pending) {
          fetch(`${API_BASE_URL}/notifications/${pending.id}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${data.token}` },
          }).catch(console.error);
        }
      }
    };
  }, []);

  const fetchNotifications = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/notifications`, {
        headers: { Authorization: `Bearer ${data.token}` },
      });
      const json = await res.json() as { notifications?: Notification[] };
      setNotifications(json.notifications ?? []);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    } finally {
      setLoading(false);
    }
  };

  const showToast = () => {
    setToastVisible(true);
    Animated.timing(toastOpacity, {
      toValue: 1,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const hideToast = (callback?: () => void) => {
    Animated.timing(toastOpacity, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setToastVisible(false);
      callback?.();
    });
  };

  const handleDelete = (id: number) => {
    const item = notifications.find((n) => n.id === id);
    if (!item) return;

    // Commit any already-pending delete before starting a new one
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
      const prev = pendingDeleteRef.current;
      if (prev) {
        fetch(`${API_BASE_URL}/notifications/${prev.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${data.token}` },
        }).catch(console.error);
      }
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
    pendingDeleteRef.current = { id, item };
    showToast();

    timerRef.current = setTimeout(() => {
      const pending = pendingDeleteRef.current;
      if (!pending) return;
      pendingDeleteRef.current = null;
      timerRef.current = null;
      fetch(`${API_BASE_URL}/notifications/${pending.id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${data.token}` },
      }).catch(console.error);
      hideToast();
    }, 4000);
  };

  const handleUndo = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const pending = pendingDeleteRef.current;
    pendingDeleteRef.current = null;

    if (pending) {
      setNotifications((prev) =>
        [...prev, pending.item].sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        ),
      );
    }

    hideToast();
  };

  const handleClearAll = async () => {
    // Cancel any in-flight pending delete — clear all supersedes it
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDeleteRef.current = null;
    hideToast();
    setNotifications([]);

    try {
      await fetch(`${API_BASE_URL}/notifications`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${data.token}` },
      });
    } catch (err) {
      console.error('Failed to clear notifications:', err);
    }
  };

  const sections = groupByDate(notifications);
  const isEmpty = !loading && notifications.length === 0;

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top', 'left', 'right']}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4">
          <TouchableOpacity
            onPress={() => router.back()}
            className="w-10 h-10 justify-center"
          >
            <ArrowLeft size={24} color="#020B12" />
          </TouchableOpacity>

          <Text className="text-lg font-bold text-[#020B12]">Activity</Text>

          {notifications.length > 0 ? (
            <TouchableOpacity
              onPress={handleClearAll}
              className="w-[60px] items-end justify-center"
            >
              <Text className="text-sm text-lhlBurntOrange font-semibold">Clear all</Text>
            </TouchableOpacity>
          ) : (
            <View className="w-[60px]" />
          )}
        </View>

        <View className="h-px bg-[#D2DEE0] mx-5" />

        {/* Content */}
        {isEmpty ? (
          <View className="flex-1 items-center justify-center">
            <Text className="text-base text-[#9A9A9A]">No new notifications</Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => (
              <NotificationRow item={item} onDelete={handleDelete} />
            )}
            renderSectionHeader={({ section: { title } }) => (
              <Text className="text-[13px] font-semibold text-[#9A9A9A] px-5 pt-4 pb-2 bg-lhlBackgroundColor">
                {title}
              </Text>
            )}
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        )}

        {/* Toast */}
        {toastVisible && (
          <Animated.View
            className="absolute bottom-[100px] left-5 right-5 bg-[#020B12] rounded-xl px-4 py-[14px] flex-row items-center justify-between"
            style={{
              opacity: toastOpacity,
              shadowColor: '#000',
              shadowOpacity: 0.2,
              shadowRadius: 8,
              elevation: 6,
            }}
          >
            <Text className="text-white text-sm flex-1">Notification deleted</Text>
            <TouchableOpacity onPress={handleUndo}>
              <Text className="text-lhlBurntOrange text-sm font-bold ml-4">Undo</Text>
            </TouchableOpacity>
          </Animated.View>
        )}
      </SafeAreaView>
    </GestureHandlerRootView>
  );
}
