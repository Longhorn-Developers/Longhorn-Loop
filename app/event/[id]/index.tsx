import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
// Event detail screen at /event/[id]. RSVP button prefers `rsvp_url`,
// falls back to `event_url`. Attendees come from GET /events/:id/attendees;
// the share button opens the platform share sheet (app/lib/shareEvent.ts).

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import CalendarIcon from '@/assets/images/calendar.svg';
import ExternalLinkIcon from '@/assets/images/external-link.svg';
import FlagIcon from '@/assets/images/flag.svg';
import MapIcon from '@/assets/images/map.svg';
import ShareIcon from '@/assets/images/share.svg';
import { ApiEvent } from '@/app/components/EventCard';
import EventLocationMapModal from '@/app/components/modals/EventLocationMapModal';
import ConfirmModal from '@/app/components/rsvp/ConfirmModal';
import { AvatarDisplay, hasAvatar } from '@/app/components/profile/AvatarDisplay';
import RsvpSuccessToast from '@/app/components/rsvp/RsvpSuccessToast';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api, ApiError } from '@/app/lib/api';
import { events as eventsKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { addRsvp, removeRsvp } from '@/app/lib/rsvpStore';
import { shareEvent } from '@/app/lib/shareEvent';
import { recordView } from '@/app/lib/signals';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import type { AvatarConfig } from '@/shared/avatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LinearGradient } from 'expo-linear-gradient';
import { useLocalSearchParams, useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Container aspect ratio for the poster. Defaults to portrait since most
// flyers are vertical.
function posterAspectRatio(kind: string | null): number {
  switch (kind) {
    case 'horizontal':
      return 1.4;
    case 'square':
      return 1;
    case 'vertical':
    case 'none':
    default:
      return 0.72;
  }
}

function formatShortDate(isoString: string): string {
  const date = new Date(isoString);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const month = months[date.getMonth()];
  const day = date.getDate();
  const suffix = (n: number) => {
    if (n >= 11 && n <= 13) return 'th';
    switch (n % 10) {
      case 1:
        return 'st';
      case 2:
        return 'nd';
      case 3:
        return 'rd';
      default:
        return 'th';
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

function MetaRow({ event, token }: { event: ApiEvent; token: string | null }) {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <View style={{ flexDirection: 'row', gap: 16, marginBottom: 24 }}>
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={styles.metaIconBadge}>
          {/*
            theme-exempt: the badge underneath is colors.brand in both themes, so
            the glyph on top is white in both. calendar.svg paints from
            currentColor, so without this it inherited inkSecondary and read as a
            dark grey icon on burnt orange. map.svg next to it has fill="white"
            baked in, which is why only the calendar looked wrong.
          */}
          <CalendarIcon width={16} height={16} color="#FFFFFF" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaPrimary}>{formatShortDate(event.start_datetime)}</Text>
          <Text style={styles.metaSecondary}>{formatShortTime(event.start_datetime)}</Text>
        </View>
      </View>

      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <TouchableOpacity
          style={styles.metaIconBadge}
          onPress={() => setMapOpen(true)}
          accessibilityLabel="Show location on map"
        >
          <MapIcon width={16} height={16} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={styles.metaPrimary} numberOfLines={2}>
            {event.location_full || event.location_short || 'Location TBD'}
          </Text>
        </View>
      </View>

      <EventLocationMapModal
        visible={mapOpen}
        onClose={() => setMapOpen(false)}
        event={event}
        token={token}
      />
    </View>
  );
}

interface Attendee {
  id: number;
  first_name: string;
  last_name: string;
  avatar: number | null;
  avatar_config: AvatarConfig | null;
  profile_photo_url: string | null;
}

interface AttendeesResponse {
  attendees: Attendee[];
  count: number;
}

// Faces + count for everyone who has RSVP'd, from GET /events/:id/attendees.
// The endpoint is auth-gated, so signed-out viewers get the section without a
// count rather than a failed request.
function AttendeesRow({
  eventId,
  token,
  onShare,
}: {
  eventId: string;
  token: string | null;
  onShare: () => void;
}) {
  const colors = useThemeColors();
  // Each face opens that person's public profile (LOOP-180). The attendee list
  // is where you actually encounter a stranger in this app, so it is the entry
  // point the profile screen was built for.
  const router = useRouter();

  const { data, isLoading } = useQuery({
    queryKey: eventsKeys.attendees(eventId),
    queryFn: () => api.get<AttendeesResponse>(`/events/${eventId}/attendees`, { token }),
    enabled: !!token,
  });

  const attendees = data?.attendees ?? [];
  const count = data?.count ?? 0;

  // Nobody has RSVP'd yet — say so rather than showing an empty face stack.
  const label = isLoading
    ? '—'
    : count === 0
      ? 'Be the first to RSVP'
      : `${count} ${count === 1 ? 'student' : 'students'}`;

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
          {attendees.map((attendee, i) => (
            <TouchableOpacity
              key={attendee.id}
              accessibilityRole="button"
              accessibilityLabel={`View ${attendee.first_name}’s profile`}
              onPress={() => router.push(`/user/${attendee.id}`)}
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                overflow: 'hidden',
                backgroundColor: colors.brand,
                borderWidth: 2,
                borderColor: colors.surface,
                marginLeft: i === 0 ? 0 : -8,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {hasAvatar(attendee) ? (
                <AvatarDisplay user={attendee} size={28} />
              ) : (
                // theme-exempt: initial sits on the brand-coloured fill above
                <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                  {attendee.first_name?.[0]?.toUpperCase() ?? '?'}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <Text
          style={{
            marginLeft: attendees.length > 0 ? 10 : 0,
            fontSize: 14,
            color: colors.ink,
          }}
        >
          {label}
        </Text>
      </View>

      <TouchableOpacity
        accessibilityRole="button"
        accessibilityLabel="Share this event"
        onPress={onShare}
        hitSlop={8}
        style={{
          width: 36,
          height: 36,
          borderRadius: 8,
          backgroundColor: colors.brand,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ShareIcon width={16} height={18} />
      </TouchableOpacity>
    </View>
  );
}

type SavedListResponse = { events: ApiEvent[] };

export default function EventDetailScreen() {
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: onboarding } = useOnboarding();
  const token = onboarding.token || null;
  const queryClient = useQueryClient();

  // RSVP UI state stays local — initialised from the event query (is_rsvped field).
  const [isRsvped, setIsRsvped] = useState(false);
  const [showOpenLinkModal, setShowOpenLinkModal] = useState(false);
  const [showDidYouRsvpModal, setShowDidYouRsvpModal] = useState(false);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [showToast, setShowToast] = useState(false);
  // Transient pill for the share fallbacks. Native share sheets report their
  // own result, so this only ever fires on web (clipboard copy or failure).
  const [shareNotice, setShareNotice] = useState<string | null>(null);

  // Fetch the event.
  const eventQuery = useQuery({
    queryKey: eventsKeys.detail(id!),
    queryFn: () => api.get<ApiEvent>(`/events/${id}`, { token }),
    enabled: !!id,
  });

  // Fetch saved IDs so we can show the correct bookmark state.
  const savedQuery = useQuery({
    queryKey: savedKeys.list(),
    queryFn: () => api.get<SavedListResponse>('/saved', { token }),
    enabled: !!token,
  });

  const event = eventQuery.data ?? null;
  const isSaved = React.useMemo(() => {
    const list = savedQuery.data?.events ?? [];
    return list.some((e) => String(e.id) === String(id));
  }, [savedQuery.data, id]);

  // Optimistic toggle save.
  const toggleSave = useMutation({
    mutationFn: async (wasSaved: boolean) => {
      if (!event) return;
      if (wasSaved) {
        await api.delete(`/saved/${event.id}`, { token });
      } else {
        await api.post(`/saved/${event.id}`, { token });
      }
    },
    onMutate: async (wasSaved) => {
      if (!event) return;
      await queryClient.cancelQueries({ queryKey: savedKeys.list() });
      const previous = queryClient.getQueryData<SavedListResponse>(savedKeys.list());
      queryClient.setQueryData<SavedListResponse>(savedKeys.list(), (old) => {
        const list = old?.events ?? [];
        if (wasSaved) {
          return { events: list.filter((e) => e.id !== event.id) };
        }
        return { events: [...list, { id: event.id } as ApiEvent] };
      });
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(savedKeys.list(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: savedKeys.list() });
    },
  });

  const handleToggleSave = () => {
    if (!token || !event) return;
    toggleSave.mutate(isSaved);
  };

  // Sharing is deliberately not auth-gated: a signed-out viewer can still pass
  // an event along, which is the cheapest way we get new users.
  const handleShare = async () => {
    if (!event) return;
    const outcome = await shareEvent(event);
    if (outcome === 'copied') setShareNotice('Link copied');
    else if (outcome === 'failed') setShareNotice('Couldn\u2019t share this event');
  };

  useEffect(() => {
    if (!shareNotice) return;
    const timer = setTimeout(() => setShareNotice(null), 2500);
    return () => clearTimeout(timer);
  }, [shareNotice]);

  // Seed isRsvped from the event response once it resolves.
  useEffect(() => {
    if (event?.is_rsvped !== undefined) {
      setIsRsvped(event.is_rsvped);
    }
  }, [event?.is_rsvped]);

  // Record a view once the event resolves. Deduped per user server-side
  useEffect(() => {
    if (event?.id) {
      recordView(event.id, token);
    }
  }, [event?.id, token]);

  // Map the query state to the existing loading / error / event UI.
  const loading = eventQuery.isPending;
  const error = eventQuery.isError
    ? eventQuery.error instanceof ApiError && eventQuery.error.status === 404
      ? 'This event could not be found.'
      : 'Something went wrong loading this event.'
    : null;

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

  // The cached detail row is what re-seeds isRsvped on the next mount, so it has
  // to move with the RSVP or the button forgets itself. See the comment on
  // confirmRsvp below.
  const patchCachedRsvpState = (next: boolean) => {
    queryClient.setQueryData<ApiEvent>(eventsKeys.detail(String(id)), (old) =>
      old ? { ...old, is_rsvped: next } : old,
    );
  };

  const confirmRsvp = async () => {
    if (!event) return;
    await addRsvp(event.id, token);
    setIsRsvped(true);
    setShowToast(true);
    // isRsvped is local state seeded from the event query, and leaving the screen
    // unmounts it. staleTime is 30s (app/_layout.tsx), so coming back inside that
    // window replayed a cached row still saying is_rsvped: false and the button
    // reverted to "RSVP" — the bug bash's "IM GOING doesn't stay". Writing through
    // to the cache fixes it without a second round trip; the server already
    // computes is_rsvped correctly on GET /events/:id.
    patchCachedRsvpState(true);
    // The caller has just joined the list they're looking at.
    queryClient.invalidateQueries({ queryKey: eventsKeys.attendees(String(id)) });
  };

  const confirmCancel = async () => {
    if (!event) return;
    await removeRsvp(event.id, token);
    setIsRsvped(false);
    setShowCancelModal(false);
    patchCachedRsvpState(false);
    queryClient.invalidateQueries({ queryKey: eventsKeys.attendees(String(id)) });
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
      <SafeAreaView className="flex-1 bg-lhlSurface">
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.accent} />
        </View>
      </SafeAreaView>
    );
  }

  if (error || !event) {
    return (
      <SafeAreaView className="flex-1 bg-lhlSurface">
        <View className="px-5 pt-4">
          <TouchableOpacity onPress={() => router.back()}>
            <Text style={{ fontSize: 16, color: colors.accent }}>‹ Back</Text>
          </TouchableOpacity>
        </View>
        <View className="flex-1 items-center justify-center px-8">
          <Text style={{ fontSize: 16, color: colors.ink, textAlign: 'center' }}>
            {error || 'Event not found.'}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const hasRsvpLink = !!event.rsvp_url;
  // Chips are our own benefits + classifier-assigned taxonomy tags — not the
  // raw scraped categories (which surfaced generic labels like "Social").
  const chips = [...(event.benefits ?? []), ...(event.tags ?? [])];

  // Scraped events carry a host NAME but no host ID -- they are never linked to
  // an `organizations` row. Pushing `/org/${undefined}/profile` produced the
  // literal path "/org/undefined/profile", which Number()s to NaN on the org
  // screen: a blank page, and then POST /orgs/NaN/follow, which the Worker
  // correctly refuses with 400 INVALID_ORG_ID. The user just sees
  // "could not update follow. Try again."
  //
  // There is no page to send them to, so the host stops being a link.
  const hostOrgId = Number(event.host_organization_id);
  const canOpenHostOrg = Number.isInteger(hostOrgId) && hostOrgId > 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Soft two-layer gradient behind the poster. */}
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.background }}>
          <View style={{ position: 'relative' }}>
            <LinearGradient
              // theme-exempt: warm under-layer, only ever seen through the 15% window
              // in the layer above; it reads as a soft haze in either theme.
              colors={['rgba(146,141,135,1)', 'rgba(248,239,229,1)']}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />
            <LinearGradient
              // The opaque ends are the page background; the middle stop is a
              // translucent grey that works over either theme.
              colors={[colors.background, 'rgba(146,141,135,0.15)', colors.background]}
              locations={[0, 0.5144, 1]}
              start={{ x: 0.5, y: 0 }}
              end={{ x: 0.5, y: 1 }}
              style={StyleSheet.absoluteFill}
            />

            <View
              style={{
                paddingTop: 8,
                paddingBottom: 24,
                paddingHorizontal: 24,
                alignItems: 'center',
              }}
            >
              <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
                <ArrowLeftIcon width={20} height={20} color={colors.ink} />
              </TouchableOpacity>

              <View
                style={[
                  styles.poster,
                  { aspectRatio: posterAspectRatio(event.image_aspect_ratio) },
                ]}
              >
                {event.image_url ? (
                  <Image
                    source={{ uri: event.image_url }}
                    style={{ width: '100%', height: '100%' }}
                    resizeMode="contain"
                  />
                ) : (
                  // Was a grey box reading "No image", which told the user
                  // nothing and looked like a failed load.
                  <EventFlyerPlaceholder seed={event?.id} />
                )}
              </View>
            </View>
          </View>
        </SafeAreaView>

        <View style={{ paddingHorizontal: 20, paddingTop: 20 }}>
          <Text style={styles.title}>{event.title}</Text>

          <MetaRow event={event} token={token} />

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
            {/* Opens the org's PUBLIC profile (LOOP-180), never the management
                console — most people tapping this are not members, and the
                console 403s them. */}
            <TouchableOpacity
              accessibilityRole={canOpenHostOrg ? 'button' : 'text'}
              accessibilityLabel={
                canOpenHostOrg
                  ? `View ${event.host_organization_name}`
                  : (event.host_organization_name ?? 'Host organization')
              }
              disabled={!canOpenHostOrg}
              // No press feedback when there is nowhere to go -- a row that
              // dims on touch and then does nothing reads as a broken link.
              activeOpacity={canOpenHostOrg ? 0.2 : 1}
              onPress={() => router.push(`/org/${hostOrgId}/profile`)}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}
            >
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
                    backgroundColor: colors.brand,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>
                    {event.host_organization_name?.[0] ?? '?'}
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 14, color: colors.ink, flex: 1 }} numberOfLines={1}>
                {event.host_organization_name}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={{ height: 1, backgroundColor: colors.border, marginVertical: 12 }} />

          <Text style={styles.sectionHeader}>Attendees</Text>
          <AttendeesRow eventId={String(id)} token={token} onShare={handleShare} />

          <TouchableOpacity
            onPress={() => router.push(`/event/${id}/report`)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          >
            <FlagIcon width={12} height={14} />
            <Text style={{ color: colors.destructive, fontSize: 14, fontWeight: '600' }}>
              Report this event
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/*
        Deliberately a View and not SafeAreaView edges={['bottom']}. That added the
        whole bottom inset (~34px on a home-indicator device) and then actionBar's
        own paddingVertical added 12 more underneath the buttons — two paddings
        stacked, which is the bug bash's "too much padding under the save button
        and RSVP button". Now there is one: clear the indicator where there is one,
        fall back to 12 where there isn't.
      */}
      <View style={[styles.actionBarWrapper, { paddingBottom: Math.max(insets.bottom, 12) }]}>
        <View style={styles.actionBar}>
          <TouchableOpacity onPress={handleToggleSave} style={styles.bookmarkButton}>
            <BookmarkGlyph saved={isSaved} width={14} height={18} idleColor={colors.ink} />
          </TouchableOpacity>

          <Pressable
            onPress={handleRsvpPress}
            style={[styles.rsvpButton, { backgroundColor: isRsvped ? colors.info : colors.brand }]}
          >
            <Text style={styles.rsvpButtonText}>{isRsvped ? "I'm Going" : 'RSVP'}</Text>
            {isRsvped ? (
              // theme-exempt: tick sits on the filled "Going" button, white in both themes
              <Text style={{ color: '#fff', fontSize: 16, marginLeft: 6 }}>✓</Text>
            ) : hasRsvpLink ? (
              <View style={{ marginLeft: 8 }}>
                <ExternalLinkIcon width={16} height={16} />
              </View>
            ) : null}
          </Pressable>
        </View>
      </View>

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

      {shareNotice ? (
        <View pointerEvents="none" style={styles.sharePill}>
          <Text style={styles.sharePillText}>{shareNotice}</Text>
        </View>
      ) : null}

      <RsvpSuccessToast
        visible={showToast}
        eventTitle={event.title}
        onClose={() => setShowToast(false)}
      />
    </View>
  );
}

const makeStyles = (c: ThemeColors) => ({
  backButton: {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    backgroundColor: c.surface,
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
    // Aspect ratio comes from posterAspectRatio() at render time.
    width: '70%' as const,
    borderRadius: 12,
    overflow: 'hidden' as const,
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
    color: c.ink,
    marginBottom: 16,
  },
  metaIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: c.brand,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  metaPrimary: {
    fontFamily: 'RobotoFlex_600SemiBold',
    fontSize: 14,
    fontWeight: '600' as const,
    color: c.ink,
  },
  metaSecondary: {
    fontFamily: 'RobotoFlex_400Regular',
    fontSize: 14,
    fontWeight: '400' as const,
    color: c.ink,
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 16,
    fontWeight: '700' as const,
    color: c.ink,
    marginBottom: 8,
  },
  bodyText: {
    fontSize: 14,
    color: c.ink,
    lineHeight: 21,
  },
  chip: {
    backgroundColor: c.surfaceMuted,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  chipText: {
    fontSize: 13,
    color: c.ink,
    fontWeight: '500' as const,
  },
  actionBarWrapper: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: c.surface,
    borderTopWidth: 1,
    borderTopColor: c.border,
  },
  actionBar: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    paddingHorizontal: 20,
    // Top only. The space below the buttons is the wrapper's safe-area padding —
    // see the comment where actionBarWrapper is rendered.
    paddingTop: 12,
    gap: 12,
  },
  bookmarkButton: {
    width: 48,
    height: 48,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: c.border,
    backgroundColor: c.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rsvpButton: {
    flex: 1,
    height: 48,
    borderRadius: 8,
    backgroundColor: c.brand,
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rsvpButtonText: {
    // theme-exempt: label on the filled RSVP button (brand or info), white in both themes
    color: '#fff',
    fontSize: 16,
    fontWeight: '700' as const,
  },
  sharePill: {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    bottom: 96,
    alignItems: 'center' as const,
  },
  sharePillText: {
    backgroundColor: c.ink,
    color: c.surface,
    fontSize: 13,
    fontWeight: '600' as const,
    borderRadius: 999,
    overflow: 'hidden' as const,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
