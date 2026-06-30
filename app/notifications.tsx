import { ArrowLeft } from 'phosphor-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  SectionList,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { API_BASE_URL } from '@/app/config/api';

// ---------- Types ----------

interface Notification {
  id: number;
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

const { width: SCREEN_WIDTH } = Dimensions.get('window');
const SNAP_THRESHOLD = 90; // px to reveal delete button
const DELETE_THRESHOLD = SCREEN_WIDTH * 0.35; // full-swipe delete

function NotificationRow({
  item,
  onDelete,
}: {
  item: Notification;
  onDelete: (id: number) => void;
}) {
  const isUnread = !item.read_at;
  const translateX = useSharedValue(0);
  const rowHeight = useSharedValue(72);
  const rowOpacity = useSharedValue(1);
  const isSnapped = useSharedValue(false); // locked at delete-button position
  const startX = useSharedValue(0);
  const isDeletingRef = useRef(false);

  const triggerDelete = useCallback(() => {
    if (isDeletingRef.current) return;
    isDeletingRef.current = true;
    onDelete(item.id);
  }, [item.id, onDelete]);

  const collapseAndDelete = useCallback(() => {
    'worklet';
    translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 }, () => {
      rowHeight.value = withTiming(0, { duration: 200 });
      rowOpacity.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(triggerDelete)();
      });
    });
  }, [translateX, rowHeight, rowOpacity, triggerDelete]);

  const panGesture = Gesture.Pan()
    .activeOffsetX([-15, 15]) // must move 15px horizontally before activating (fixes scroll conflict)
    .failOffsetY([-10, 10]) // cancel if vertical movement > 10px (lets scroll take over)
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate((e) => {
      const newX = startX.value + e.translationX;
      // Allow left swipe only, clamp at 0
      translateX.value = Math.min(0, newX);
    })
    .onEnd((e) => {
      const currentX = translateX.value;
      const velocity = e.velocityX;

      // Full swipe delete — past threshold or fast flick
      if (currentX < -DELETE_THRESHOLD || velocity < -800) {
        collapseAndDelete();
        return;
      }

      // Snap to show delete button — between half-snap and threshold
      if (currentX < -(SNAP_THRESHOLD * 0.5)) {
        isSnapped.value = true;
        translateX.value = withSpring(-SNAP_THRESHOLD, {
          damping: 20,
          stiffness: 200,
        });
        return;
      }

      // Snap back to closed
      isSnapped.value = false;
      translateX.value = withSpring(0, {
        damping: 20,
        stiffness: 200,
      });
    });

  const handleDeleteTap = useCallback(() => {
    // Animate off-screen then collapse
    translateX.value = withTiming(-SCREEN_WIDTH, { duration: 200 }, () => {
      rowHeight.value = withTiming(0, { duration: 200 });
      rowOpacity.value = withTiming(0, { duration: 200 }, () => {
        runOnJS(triggerDelete)();
      });
    });
  }, [translateX, rowHeight, rowOpacity, triggerDelete]);

  // Animated styles
  const rowAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
  }));

  const containerAnimatedStyle = useAnimatedStyle(() => ({
    height: rowHeight.value,
    opacity: rowOpacity.value,
    overflow: 'hidden' as const,
  }));

  const deleteBackgroundStyle = useAnimatedStyle(() => {
    const progress = Math.min(Math.abs(translateX.value) / DELETE_THRESHOLD, 1);
    return {
      opacity: 0.3 + progress * 0.7,
    };
  });

  return (
    <Animated.View style={containerAnimatedStyle}>
      <View style={{ position: 'relative', flex: 1 }}>
        {/* Red delete background — sits behind the row */}
        <Animated.View
          style={[
            {
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: 0,
              right: 0,
              backgroundColor: '#EF4444',
              justifyContent: 'center',
              alignItems: 'flex-end',
            },
            deleteBackgroundStyle,
          ]}
        >
          {/* Tappable delete button area */}
          <TouchableOpacity
            onPress={handleDeleteTap}
            activeOpacity={0.7}
            style={{
              width: SNAP_THRESHOLD,
              height: '100%',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>Delete</Text>
          </TouchableOpacity>
        </Animated.View>

        {/* Foreground row that slides */}
        <GestureDetector gesture={panGesture}>
          <Animated.View style={rowAnimatedStyle}>
            <View className="flex-row items-center px-5 py-3 bg-lhlBackgroundColor gap-3">
              {/* Unread dot */}
              {isUnread && (
                <View
                  style={{
                    position: 'absolute',
                    left: 8,
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: '#BF5700',
                  }}
                />
              )}

              {/* Avatar */}
              {item.avatar_url ? (
                <Image
                  source={{ uri: item.avatar_url }}
                  className="w-10 h-10 rounded-full shrink-0"
                />
              ) : (
                <View
                  className="w-10 h-10 rounded-full shrink-0 items-center justify-center"
                  style={{ backgroundColor: '#BF5700' }}
                >
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 16 }}>
                    {item.title.charAt(0).toUpperCase()}
                  </Text>
                </View>
              )}

              {/* Text content */}
              <View className="flex-1 gap-0.5">
                <Text
                  className="text-sm leading-5"
                  style={{
                    fontWeight: isUnread ? '700' : '400',
                    color: isUnread ? '#020B12' : '#6B7280',
                  }}
                  numberOfLines={2}
                >
                  {item.title}
                </Text>
                {item.subtitle ? (
                  <Text
                    className="text-[13px] leading-[18px]"
                    style={{ color: isUnread ? '#6B7280' : '#9CA3AF' }}
                    numberOfLines={1}
                  >
                    {item.subtitle}
                  </Text>
                ) : null}
              </View>

              {/* Event thumbnail */}
              {item.thumbnail_url ? (
                <Image
                  source={{ uri: item.thumbnail_url }}
                  className="w-14 h-14 rounded-lg shrink-0"
                />
              ) : (
                <View className="w-14 h-14 rounded-lg shrink-0 bg-[#D9D9D9]" />
              )}
            </View>
          </Animated.View>
        </GestureDetector>
      </View>
    </Animated.View>
  );
}

// ---------- Main Screen ----------

export default function NotificationsScreen() {
  const router = useRouter();
  const { data } = useOnboarding();
  const token = data.token || null;

  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [toastVisible, setToastVisible] = useState(false);

  const pendingDeleteRef = useRef<{ id: number; item: Notification; index: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastOpacityVal = useSharedValue(0);

  // Fetch notifications from backend.
  useEffect(() => {
    if (!token) {
      setIsLoading(false);
      return;
    }

    const fetchNotifications = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/notifications`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const result = await res.json();
          setNotifications(result.notifications ?? []);
        }
      } catch {
        // Silently fail — show empty state
      } finally {
        setIsLoading(false);
      }
    };

    fetchNotifications();
  }, [token]);

  const sections = groupByDate(notifications);
  const isEmpty = notifications.length === 0;

  const toastAnimatedStyle = useAnimatedStyle(() => ({
    opacity: toastOpacityVal.value,
  }));

  const showToast = () => {
    setToastVisible(true);
    toastOpacityVal.value = withTiming(1, { duration: 200 });
  };

  const hideToast = (callback?: () => void) => {
    toastOpacityVal.value = withTiming(0, { duration: 200 });
    setTimeout(() => {
      setToastVisible(false);
      callback?.();
    }, 220);
  };

  const handleDelete = (id: number) => {
    const index = notifications.findIndex((n) => n.id === id);
    if (index === -1) return;
    const item = notifications[index];

    // Commit any already-pending delete
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setNotifications((prev) => prev.filter((n) => n.id !== id));
    pendingDeleteRef.current = { id, item, index };
    showToast();

    timerRef.current = setTimeout(() => {
      const deletedId = pendingDeleteRef.current?.id;
      pendingDeleteRef.current = null;
      timerRef.current = null;
      hideToast();

      // Fire-and-forget delete to backend.
      if (deletedId && token) {
        fetch(`${API_BASE_URL}/notifications/${deletedId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
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
      setNotifications((prev) => {
        const newList = [...prev];
        newList.splice(pending.index, 0, pending.item);
        return newList;
      });
    }

    hideToast();
  };

  const handleClearAll = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pendingDeleteRef.current = null;
    hideToast();
    setNotifications([]);

    // Fire-and-forget clear all to backend.
    if (token) {
      fetch(`${API_BASE_URL}/notifications`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
  };

  return (
    <GestureHandlerRootView className="flex-1">
      <SafeAreaView className="flex-1 bg-lhlBackgroundColor" edges={['top', 'left', 'right']}>
        {/* Header */}
        <View className="flex-row items-center justify-between px-5 py-4">
          <TouchableOpacity onPress={() => router.back()} className="w-10 h-10 justify-center">
            <ArrowLeft size={24} color="#020B12" />
          </TouchableOpacity>

          <Text className="text-lg font-bold text-[#020B12]">Notifications</Text>

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
        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#BF5700" />
          </View>
        ) : isEmpty ? (
          <View className="flex-1 items-center justify-center px-10">
            <Text style={{ fontSize: 48, marginBottom: 16 }}>🔔</Text>
            <Text className="text-base text-[#374151] font-semibold mb-2 text-center">
              No new notifications
            </Text>
            <Text className="text-sm text-[#9CA3AF] text-center">
              When you have upcoming events or activity, they&apos;ll show up here.
            </Text>
          </View>
        ) : (
          <SectionList
            sections={sections}
            keyExtractor={(item) => item.id.toString()}
            renderItem={({ item }) => <NotificationRow item={item} onDelete={handleDelete} />}
            renderSectionHeader={({ section: { title } }) => (
              <Text className="text-[13px] font-semibold text-lhlBurntOrange px-5 pt-4 pb-2 bg-lhlBackgroundColor">
                {title}
              </Text>
            )}
            contentContainerStyle={{ paddingBottom: 120 }}
            showsVerticalScrollIndicator={false}
            stickySectionHeadersEnabled={false}
          />
        )}

        {/* Undo Toast */}
        {toastVisible && (
          <Animated.View
            className="absolute bottom-[100px] left-5 right-5 bg-[#020B12] rounded-xl px-4 py-[14px] flex-row items-center justify-between"
            style={[
              toastAnimatedStyle,
              {
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 8,
                elevation: 6,
              },
            ]}
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
