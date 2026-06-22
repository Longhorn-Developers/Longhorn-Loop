// Event detail screen at /event/[id]. RSVP button prefers `rsvp_url`,
// falls back to `event_url`. Attendees, share, and report are mocked
// pending backend support.

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import BookmarkIcon from '@/assets/images/bookmark.svg';
import CalendarIcon from '@/assets/images/calendar.svg';
import ExternalLinkIcon from '@/assets/images/external-link.svg';
import FlagIcon from '@/assets/images/flag.svg';
import MapIcon from '@/assets/images/map.svg';
import ShareIcon from '@/assets/images/share.svg';
import { ApiEvent } from '@/app/components/EventCard';
import ConfirmModal from '@/app/components/rsvp/ConfirmModal';
import RsvpSuccessToast from '@/app/components/rsvp/RsvpSuccessToast';
import { API_BASE_URL } from '@/app/config/api';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { addRsvp, isRsvped as isRsvpedInStore, removeRsvp } from '@/app/lib/rsvpStore';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const BURNT_ORANGE = '#BF5700';
const GOING_BLUE = '#2591D4';
const BADGE_BROWN = '#9D4A06';
const BG_OFFWHITE = '#F7F4EF';
const TEXT_PRIMARY = '#020B12';
const TEXT_MUTED = '#7A7A7A';
const BORDER_GREY = '#E5E5E5';
const CHIP_BG = '#F1F1F1';
const REPORT_RED = '#E11D48';

function formatShortDate(isoString: string): string {
  const date = new Date(isoString);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const suffix = (n: number) => {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  return `${month} ${day}${suffix(day)}`;
}

/**
 * Format the start datetime as a short time label like "12:30 PM".
 */
function formatShortTime(isoString: string): string {
  const date = new Date(isoString);
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return minutes === 0
    ? `${hours}:00 ${ampm}`
    : `${hours}:${minutes.toString().padStart(2, '0')} ${ampm}`;
}

function MetaRow({ event }: { event: ApiEvent }) {
  return (
    <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={styles.metaIconBadge}>
          <CalendarIcon width={16} height={16} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaPrimary}>{formatShortDate(event.start_datetime)}</Text>
          <Text style={styles.metaSecondary}>{formatShortTime(event.start_datetime)}</Text>
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={styles.metaIconBadge}>
          <MapIcon width={16} height={16} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaPrimary} numberOfLines={2}>
            {event.location_full || event.location_short || 'Location TBD'}
          </Text>
        </View>
      </View>
    </View>
  );
}

// TODO: replace mock data with a real attendees endpoint once backend supports RSVPs.
function AttendeesRow() {
  const mockAvatars = ['#F06292', '#81C784', '#FFB74D'];
  const mockCount = 142;

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: 18,
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flexDirection: 'row' }}>
          {mockAvatars.map((color, i) => (
            <View
              key={i}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                backgroundColor: color,
                borderWidth: 2,
                borderColor: '#fff',
                marginLeft: i === 0 ? 0 : -8,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                {String.fromCharCode(65 + i)}
              </Text>
            </View>
          ))}
        </View>
        <Text style={{ marginLeft: 10, fontSize: 14, color: TEXT_PRIMARY }}>
          {mockCount} students
        </Text>
      </View>

      {/* TODO: wire up share intent. */}
      <TouchableOpacity
        disabled
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: BADGE_BROWN,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.9,
        }}
      >
        <ShareIcon width={16} height={18} />
      </TouchableOpacity>
    </View>
  );
}

export default function EventDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token;

  const [event, setEvent] = useState<ApiEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSaved, setIsSaved] = useState(false);

  // RSVP state — local-only for now, persisted via AsyncStorage in rsvpStore.
  const [isRsvped, setIsRsvped] = useState(false);
  const [showOpenLinkModal, setShowOpenLinkModal] = useState(false);
  const [showDidYouRsvpModal, setShowDidYouRsvpModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showToast, setShowToast] = useState(false);

  useEffect(() => {
    if (!id) return;
    fetchEvent();
  }, [id]);

  useEffect(() => {
    if (token && id) checkIfSaved();
  }, [token, id]);

  useEffect(() => {
    if (!id) return;
    isRsvpedInStore(Number(id)).then(setIsRsvped);
  }, [id]);

  const fetchEvent = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}/events/${id}`);
      if (!res.ok) {
        setError(res.status === 404 ? 'This event could not be found.' : 'Something went wrong loading this event.');
        return;
      }
      setEvent(await res.json());
    } catch (err) {
      console.error('Failed to fetch event:', err);
      setError('Could not load event. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  };

  const checkIfSaved = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/saved`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const result = await res.json();
      if (Array.isArray(result.events)) {
        setIsSaved(result.events.some((e: ApiEvent) => String(e.id) === String(id)));
      }
    } catch (err) {
      console.error('Failed to check saved state:', err);
    }
  };

  const handleToggleSave = async () => {
    if (!token || !event) return;
    const wasSaved = isSaved;
    setIsSaved(!wasSaved);
    try {
      const res = await fetch(`${API_BASE_URL}/saved/${event.id}`, {
        method: wasSaved ? 'DELETE' : 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Request failed');
    } catch (err) {
      console.error('Failed to toggle saved event:', err);
      setIsSaved(wasSaved);
    }
  };

  // Top-level entry point for the RSVP button. Branches on current state
  // and whether the event has a dedicated rsvp_url.
  const handleRsvpPress = () => {
    if (!event) return;
    if (isRsvped) {
      setShowCancelModal(true);
      return;
    }
    if (event.rsvp_url) {
      setShowOpenLinkModal(true);
      return;
    }
    confirmRsvp();
  };

  const confirmRsvp = async () => {
    if (!event) return;
    await addRsvp(event.id);
    setIsRsvped(true);
    setShowToast(true);
  };

  const confirmCancel = async () => {
    if (!event) return;
    await removeRsvp(event.id);
    setIsRsvped(false);
    setShowCancelModal(false);
  };

  const openExternalRsvp = async () => {
    if (!event?.rsvp_url) return;
    setShowOpenLinkModal(false);
    await WebBrowser.openBrowserAsync(event.rsvp_url);
    // After the browser closes, ask whether they actually RSVPed.
    setShowDidYouRsvpModal(true);
  };

  if (loading) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={BURNT_ORANGE} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !event) {
    return (
      <SafeAreaView className="flex-1 bg-white">
        <View className="px-5 pt-4">
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontSize: 16, color: BURNT_ORANGE }}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ fontSize: 16, color: TEXT_PRIMARY, textAlign: 'center' }}>
            {error || 'Event not found.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasRsvpLink = !!event.rsvp_url;
  const chips = [
    ...(event.benefits ?? []),
    ...(event.categories?.map((c) => c.name).filter(Boolean) ?? []),
  ];

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        <SafeAreaView edges={['top']} style={{ backgroundColor: BG_OFFWHITE }}>
          <View
            style={{
              backgroundColor: BG_OFFWHITE,
              paddingTop: 8,
              paddingBottom: 24,
              paddingHorizontal: 24,
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <ArrowLeftIcon width={20} height={20} />
            </TouchableOpacity>

            <View style={styles.poster}>
              {event.image_url ? (
                <Image
                  source={{ uri: event.image_url }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <View
                  style={{
                    flex: 1,
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#D9D9D9',
                  }}
                >
                  <Text style={{ color: TEXT_MUTED, fontSize: 14 }}>No image</Text>
                </View>
              )}
            </View>
          </View>
        </SafeAreaView>

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={styles.title}>{event.title}</Text>

          <MetaRow event={event} />

          {event.description ? (
            <View style={{ marginBottom: 18 }}>
              <Text style={styles.sectionHeader}>About This Event</Text>
              <Text style={styles.bodyText}>{event.description}</Text>
            </View>
          ) : null}

          {chips.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 22 }}>
              {chips.map((label, i) => (
                <View key={`chip-${i}-${label}`} style={styles.chip}>
                  <Text style={styles.chipText}>{label}</Text>
                </View>
              ))}
            </View>
          ) : null}

          <View style={{ marginBottom: 18 }}>
            <Text style={styles.sectionHeader}>Hosted by</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              {event.org_profile_picture ? (
                <Image
                  source={{ uri: event.org_profile_picture }}
                  style={{ width: 32, height: 32, borderRadius: 16 }}
                />
              ) : (
                <View
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 16,
                    backgroundColor: BURNT_ORANGE,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    {event.host_organization_name?.[0] ?? '?'}
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 14, color: TEXT_PRIMARY, flex: 1 }} numberOfLines={1}>
                {event.host_organization_name}
              </Text>
            </View>
          </View>

          <View style={{ height: 1, backgroundColor: BORDER_GREY, marginVertical: 12 }} />

          <Text style={styles.sectionHeader}>Attendees</Text>
          <AttendeesRow />

          {/* TODO: wire up reporting flow. */}
          <TouchableOpacity disabled style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <FlagIcon width={12} height={14} />
            <Text style={{ color: REPORT_RED, fontSize: 14, fontWeight: '600' }}>
              Report this event
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={styles.actionBarWrapper}>
        <View style={styles.actionBar}>
          <TouchableOpacity onPress={handleToggleSave} style={styles.bookmarkButton}>
            <BookmarkIcon width={14} height={18} color={isSaved ? BURNT_ORANGE : TEXT_PRIMARY} />
          </TouchableOpacity>

          <Pressable
            onPress={handleRsvpPress}
            style={[
              styles.rsvpButton,
              { backgroundColor: isRsvped ? GOING_BLUE : BURNT_ORANGE },
            ]}
          >
            <Text style={styles.rsvpButtonText}>
              {isRsvped ? "I'm Going" : 'RSVP'}
            </Text>
            {isRsvped ? (
              <Text style={{ color: '#fff', fontSize: 16, marginLeft: 6 }}>✓</Text>
            ) : hasRsvpLink ? (
              <View style={{ marginLeft: 8 }}>
                <ExternalLinkIcon width={16} height={16} />
              </View>
            ) : null}
          </Pressable>
        </View>
      </SafeAreaView>

      {/* Confirmation: open external RSVP link */}
      <ConfirmModal
        visible={showOpenLinkModal}
        title="Open external link?"
        body="This RSVP will take you to an external page."
        emphasis="Do you trust this link?"
        primaryLabel="Yes, Continue"
        secondaryLabel="Cancel"
        onPrimary={openExternalRsvp}
        onSecondary={() => setShowOpenLinkModal(false)}
      />

      {/* After returning from the browser: did you actually RSVP? */}
      <ConfirmModal
        visible={showDidYouRsvpModal}
        title="Did you RSVP?"
        body={`You clicked on the external link to RSVP for "${event.title}".`}
        emphasis="Were you able to RSVP through the external link?"
        primaryLabel="Yes"
        secondaryLabel="No"
        onPrimary={() => {
          setShowDidYouRsvpModal(false);
          confirmRsvp();
        }}
        onSecondary={() => setShowDidYouRsvpModal(false)}
      />

      {/* Cancel RSVP confirmation */}
      <ConfirmModal
        visible={showCancelModal}
        title="Cancel RSVP?"
        body={`You're about to cancel your RSVP for "${event.title}."`}
        emphasis="Are you sure you don't want to go?"
        primaryLabel="Yes, cancel RSVP"
        secondaryLabel="Keep my RSVP"
        primaryDestructive
        onPrimary={confirmCancel}
        onSecondary={() => setShowCancelModal(false)}
      />

      <RsvpSuccessToast
        visible={showToast}
        eventTitle={event.title}
        onClose={() => setShowToast(false)}
      />
    </View>
  );
}

const styles = {
  backButton: {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    backgroundColor: '#fff',
    borderRadius: 999,
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
    zIndex: 10,
  },
  poster: {
    width: '60%' as const,
    aspectRatio: 0.72,
    borderRadius: 12,
    overflow: 'hidden' as const,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    marginTop: 24,
  },
  title: {
    fontSize: 22,
    fontWeight: '700' as const,
    color: TEXT_PRIMARY,
    marginBottom: 16,
  },
  metaIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: BADGE_BROWN,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  metaPrimary: {
    fontFamily: 'RobotoFlex_600SemiBold',
    fontSize: 14,
    fontWeight: '600' as const,
    color: '#000',
  },
  metaSecondary: {
    fontFamily: 'RobotoFlex_400Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    color: '#000',
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: TEXT_PRIMARY,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 14,
    color: TEXT_PRIMARY,
    lineHeight: 21,
  },
  chip: {
    backgroundColor: CHIP_BG,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    color: TEXT_PRIMARY,
    fontWeight: '500' as const,
  },
  actionBarWrapper: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: BORDER_GREY,
  },
  actionBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 12,
  },
  bookmarkButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: BORDER_GREY,
    backgroundColor: '#fff',
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rsvpButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: BURNT_ORANGE,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rsvpButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
  },
};
