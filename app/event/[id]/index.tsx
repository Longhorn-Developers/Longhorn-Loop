import EventFlyerPlaceholder from '@/app/components/EventFlyerPlaceholder';
import EventRouteCard from '@/app/components/event/EventRouteCard';
import FlyerFullscreenModal from '@/app/components/event/FlyerFullscreenModal';
import InfoRow, { RowAvatar, RowBadge, RowButton } from '@/app/components/event/InfoRow';
import ExpandableText from '@/app/components/ExpandableText';
// Event detail screen at /event/[id]. RSVP button prefers `rsvp_url`,
// falls back to `event_url`. Attendees come from GET /events/:id/attendees;
// the share button opens the platform share sheet (app/lib/shareEvent.ts).

import ArrowLeftIcon from '@/assets/images/arrow-left.svg';
import BookmarkGlyph from '@/app/components/icons/BookmarkGlyph';
import CalendarAddIcon from '@/assets/images/calendar-add.svg';
import CalendarIcon from '@/assets/images/calendar.svg';
import ExpandIcon from '@/assets/images/expand.svg';
import ExternalLinkIcon from '@/assets/images/external-link.svg';
import FlagIcon from '@/assets/images/flag.svg';
import MapIcon from '@/assets/images/map.svg';
import ShareIcon from '@/assets/images/share.svg';
import VerifiedIcon from '@/assets/images/verified.svg';
import { ApiEvent } from '@/app/components/EventCard';
import EventLocationMapModal from '@/app/components/modals/EventLocationMapModal';
import ConfirmModal from '@/app/components/rsvp/ConfirmModal';
import { AvatarDisplay, hasAvatar } from '@/app/components/profile/AvatarDisplay';
import RsvpSuccessToast from '@/app/components/rsvp/RsvpSuccessToast';
import { useOnboarding } from '@/app/context/OnboardingContext';
import { api, ApiError } from '@/app/lib/api';
import { googleCalendarUrl } from '@/app/lib/addToCalendar';
import { formatTimeRange, formatWeekdayDate } from '@/app/lib/eventDateTime';
import { openExternalUrl, toExternalHttpUrl, useExternalLinkHandoff } from '@/app/lib/externalLink';
import { events as eventsKeys, saved as savedKeys } from '@/app/lib/queryKeys';
import { addRsvp, removeRsvp } from '@/app/lib/rsvpStore';
import { shareEvent } from '@/app/lib/shareEvent';
import { recordView } from '@/app/lib/signals';
import type { ThemeColors } from '@/app/lib/themeColors';
import { useThemeColors } from '@/app/lib/themeColors';
import { useEventLocation, type EventLocation } from '@/app/lib/useEventLocation';
import { useOrgFollow } from '@/app/lib/useOrgFollow';
import type { AvatarConfig } from '@/shared/avatar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

// Container aspect ratio for the poster. Defaults to portrait since most
// flyers are vertical.
// Width of the flyer in the hero, by shape. The redesign shows a portrait flyer
// at under half the screen; a square or landscape one is wider so all three end
// up a similar height instead of the landscape one shrinking to a postage stamp.
function posterWidth(kind: string | null): `${number}%` {
  switch (kind) {
    case 'horizontal':
      return '80%';
    case 'square':
      return '60%';
    default:
      return '46%';
  }
}

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

function InfoCard({
  event,
  location,
  onAddToCalendar,
}: {
  event: ApiEvent;
  location: EventLocation;
  onAddToCalendar: () => void;
}) {
  const walkMinutes = location.walkMinutes;
  const colors = useThemeColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [mapOpen, setMapOpen] = useState(false);

  return (
    <View style={styles.card}>
      <InfoRow
        inset
        leading={
          <RowBadge>
            <CalendarIcon width={16} height={16} color={colors.ink} />
          </RowBadge>
        }
        title={formatWeekdayDate(event.start_datetime)}
        subtitle={formatTimeRange(event.start_datetime, event.end_datetime)}
        trailing={
          <RowButton
            label="Add to GCal"
            accessibilityLabel="Add to Google Calendar"
            icon={<CalendarAddIcon width={16} height={16} color={colors.brand} />}
            iconPosition="end"
            onPress={onAddToCalendar}
          />
        }
      />

      {/* An online event has no place: its "location" is a meeting link, so
          there is no address row, no divider above it and no map behind it. */}
      {location.online ? null : (
        <>
          <View style={styles.cardDivider} />

          {/* The whole row opens the map, not just the badge: with a chevron on the
          right it reads as one tappable row. The subtitle is the city, which is
          constant for a campus-only event set; the walk time joins it once the
          viewer's position is known (see useEventLocation). */}
          <InfoRow
            inset
            chevron
            leading={
              <RowBadge>
                <MapIcon width={16} height={16} color={colors.ink} />
              </RowBadge>
            }
            title={event.location_full || event.location_short || 'Location TBD'}
            titleLines={2}
            subtitle={walkMinutes != null ? `Austin TX · ${walkMinutes} min walk` : 'Austin TX'}
            accessibilityLabel="Show location on map"
            onPress={() => setMapOpen(true)}
          />

          <EventLocationMapModal
            visible={mapOpen}
            onClose={() => setMapOpen(false)}
            event={event}
            location={location}
          />
        </>
      )}
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
          // Soft fill + brand glyph, as in the redesign (was a solid brand
          // button). share.svg now paints from currentColor so the glyph can
          // follow the theme; it was only ever used here, on a brand fill.
          backgroundColor: colors.brandSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ShareIcon width={16} height={18} color={colors.brand} />
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
  const [flyerOpen, setFlyerOpen] = useState(false);
  // A write is in flight. The RSVP button used to give no sign of this at all,
  // which on a slow connection was indistinguishable from the tap having been
  // ignored -- half of what "the app freezes when you try to RSVP" (LOOP-278)
  // described. It also gates re-entry, so a second tap can't double-post.
  const [rsvpPending, setRsvpPending] = useState(false);
  // Transient pill, shared by the share fallbacks and the RSVP error paths.
  // Native share sheets report their own result, so the share side only ever
  // fires on web (clipboard copy or failure).
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

  // Follow the host org from the header row. Called up here with the other
  // hooks, before the loading / error early returns, so the id is read off the
  // possibly-undefined event; the button is only rendered for a real org id.
  // Writing the server's answer into the cached detail row keeps the button
  // right when the user leaves and comes back inside the 30s staleTime, the
  // same reason patchCachedRsvpState exists for RSVPs.
  const follow = useOrgFollow(Number(event?.host_organization_id), token, {
    onSuccess: ({ following }) => {
      queryClient.setQueryData<ApiEvent>(eventsKeys.detail(String(id)), (old) =>
        old ? { ...old, is_following_org: following } : old,
      );
    },
    onError: () => setShareNotice('Couldn’t update follow. Try again.'),
  });

  // Venue coordinate + the viewer's walk time, shared by the info card's
  // subtitle and the route card. autoLocate only reads an already-granted
  // permission, so opening an event never raises the OS prompt.
  const location = useEventLocation(event, token, { autoLocate: true });

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

  // The RSVP link as something we can actually hand a browser, or null.
  //
  // `rsvp_url` is validated on POST /events/create but NOT in
  // server/src/events/ingest.ts, so a scraped row can hold a scheme-less host,
  // a non-http scheme, or a scrap of prose a link regex mistook for a URL.
  // Deciding here means every branch below works from one answer instead of
  // testing truthiness and discovering the problem at presentation time, which
  // is how LOOP-278 crashed.
  const externalRsvpUrl = useMemo(() => toExternalHttpUrl(event?.rsvp_url), [event?.rsvp_url]);

  const externalLink = useExternalLinkHandoff({
    // Asked when they come back from the browser, never while it is opening --
    // this is another modal, and stacking one onto a presentation in flight is
    // the failure LOOP-278 was. The hook owns that timing.
    onReturn: () => setShowDidYouRsvpModal(true),
    onFailure: () => setShareNotice('Couldn’t open the RSVP link'),
  });

  // Opens a prefilled Google Calendar event. Not routed through
  // externalLink.request(): that hand-off exists to wait out a modal that is
  // still dismissing, and this button is not in one. A failed open surfaces on
  // the same pill the other actions use.
  const handleAddToCalendar = async () => {
    if (!event) return;
    const url = googleCalendarUrl(event);
    if (!url || !(await openExternalUrl(url))) {
      setShareNotice('Couldn’t open Google Calendar');
    }
  };

  // Top-level entry point for the RSVP button. Branches on current state
  // and whether the event has a usable rsvp_url.
  const handleRsvpPress = () => {
    if (!event || rsvpPending) return;
    if (isRsvped) {
      setShowCancelModal(true);
      return;
    }
    if (externalRsvpUrl) {
      setShowOpenLinkModal(true);
      return;
    }
    // A link is on the row but isn't a web address. Say so rather than
    // recording a local RSVP: on an externally ticketed event that would tell
    // the user they are going when they have not bought a ticket.
    if (event.rsvp_url) {
      setShareNotice('This event’s RSVP link isn’t a valid web address');
      return;
    }
    void confirmRsvp();
  };

  // The cached detail row is what re-seeds isRsvped on the next mount, so it has
  // to move with the RSVP or the button forgets itself. See the comment on
  // confirmRsvp below.
  const patchCachedRsvpState = (next: boolean) => {
    queryClient.setQueryData<ApiEvent>(eventsKeys.detail(String(id)), (old) =>
      old ? { ...old, is_rsvped: next } : old,
    );
  };

  // Both writes below are wrapped. addRsvp/removeRsvp go through api.ts, which
  // throws ApiError on a non-2xx and on an unreachable server (status 0) --
  // and these were called from a modal's onPress with no catch, so a flaky
  // connection produced an unhandled rejection and a button that silently
  // stayed wrong. Failing loudly and leaving the state alone is the point.
  const confirmRsvp = async () => {
    if (!event || rsvpPending) return;
    setRsvpPending(true);
    try {
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
    } catch {
      setShareNotice('Couldn’t save your RSVP. Try again.');
    } finally {
      setRsvpPending(false);
    }
  };

  const confirmCancel = async () => {
    if (!event || rsvpPending) return;
    setRsvpPending(true);
    setShowCancelModal(false);
    try {
      await removeRsvp(event.id, token);
      setIsRsvped(false);
      patchCachedRsvpState(false);
      queryClient.invalidateQueries({ queryKey: eventsKeys.attendees(String(id)) });
    } catch {
      setShareNotice('Couldn’t cancel your RSVP. Try again.');
    } finally {
      setRsvpPending(false);
    }
  };

  // "Yes, Continue" on the external-link dialog.
  //
  // This ONLY closes the dialog and queues the URL. The browser is presented
  // from the dialog's onDismissed below, because presenting it here -- in the
  // same tick as setShowOpenLinkModal(false), while the modal is still a live
  // UIViewController -- is what froze the app on iPhone and crashed it on
  // iPad. app/lib/externalLink.ts has the full account.
  const openExternalRsvp = () => {
    setShowOpenLinkModal(false);
    if (!externalLink.request(externalRsvpUrl)) {
      setShareNotice('This event’s RSVP link isn’t a valid web address');
    }
  };

  // The dialog has left the screen; safe to present the browser now. A no-op
  // if nothing was queued, so "Cancel" and a backdrop tap cost nothing.
  const { flush: flushExternalLink } = externalLink;
  const handleOpenLinkDismissed = useCallback(() => {
    flushExternalLink();
  }, [flushExternalLink]);

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

  // Only advertise the external-link affordance when the link is one we can
  // actually open -- an icon promising a hand-off that cannot happen is worse
  // than no icon.
  const hasRsvpLink = !!externalRsvpUrl;
  // The header line above the title reads from event_categories, per the
  // redesign. This used to be benefits + classifier tags because raw scraped
  // categories surfaced generic labels like "Social"; the design wants
  // categories, so those generic labels can show up on scraped events. Capped
  // at 3 so the line stays on one row at phone width, de-duped
  // case-insensitively because scrapers sometimes emit the same label twice.
  const categoryLabels = (() => {
    const seen = new Set<string>();
    const labels: string[] = [];
    for (const category of event.categories ?? []) {
      const name = category.name?.trim();
      if (!name || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      labels.push(name);
    }
    return labels.slice(0, 3);
  })();

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
  // Following needs the same real org row, and the endpoint is auth-gated, so
  // signed-out viewers get the row without the button rather than one that 401s.
  const isFollowingHost = event.is_following_org ?? false;
  const canFollowHost = canOpenHostOrg && !!token;

  return (
    <View style={{ flex: 1, backgroundColor: colors.surface }}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
      >
        {/* Flat hero, as in the redesign (was a two-layer gradient). segmentTrack is
            the warm grey the design shows behind the flyer in either theme. */}
        <SafeAreaView edges={['top']} style={{ backgroundColor: colors.segmentTrack }}>
          <View
            style={{
              paddingTop: 8,
              paddingBottom: 40,
              paddingHorizontal: 24,
              alignItems: 'center',
            }}
          >
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="Go back"
              onPress={() => router.back()}
              style={styles.backButton}
            >
              <ArrowLeftIcon width={24} height={24} color={colors.ink} />
            </TouchableOpacity>

            {/* Only offered when there is a real image: the placeholder has
                nothing more to show at full size. */}
            {event.image_url ? (
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="View flyer fullscreen"
                onPress={() => setFlyerOpen(true)}
                style={styles.expandButton}
              >
                <ExpandIcon width={20} height={20} color={colors.brand} />
              </TouchableOpacity>
            ) : null}

            <View
              style={[
                styles.poster,
                {
                  aspectRatio: posterAspectRatio(event.image_aspect_ratio),
                  width: posterWidth(event.image_aspect_ratio),
                },
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
        </SafeAreaView>

        <View style={styles.sheet}>
          {categoryLabels.length > 0 ? (
            <Text style={styles.categoryLine} numberOfLines={1}>
              {categoryLabels.join(' · ').toUpperCase()}
            </Text>
          ) : null}

          <Text style={styles.title}>{event.title}</Text>

          {/* Host row: avatar + name (+ verified check) open the org's PUBLIC
              profile (LOOP-180), never the management console — most people
              tapping this are not members, and the console 403s them. Follow
              sits beside it as its own control. */}
          {event.host_organization_name ? (
            <InfoRow
              style={{ marginBottom: 20 }}
              leading={
                <RowAvatar uri={event.org_profile_picture} name={event.host_organization_name} />
              }
              title={event.host_organization_name}
              titleAccessory={
                event.org_verified ? (
                  <VerifiedIcon width={16} height={16} style={{ flexShrink: 0 }} />
                ) : null
              }
              // No handler when there is nowhere to go: a row that dims on touch
              // and then does nothing reads as a broken link.
              onPress={canOpenHostOrg ? () => router.push(`/org/${hostOrgId}/profile`) : undefined}
              accessibilityLabel={`View ${event.host_organization_name}`}
              trailing={
                canFollowHost ? (
                  <RowButton
                    shape="pill"
                    label={isFollowingHost ? 'Following' : 'Follow'}
                    accessibilityLabel={
                      isFollowingHost
                        ? `Unfollow ${event.host_organization_name}`
                        : `Follow ${event.host_organization_name}`
                    }
                    active={isFollowingHost}
                    pending={follow.isPending}
                    onPress={() => follow.mutate(!isFollowingHost)}
                  />
                ) : undefined
              }
            />
          ) : null}

          <InfoCard event={event} location={location} onAddToCalendar={handleAddToCalendar} />

          {event.description ? (
            <View style={[styles.card, styles.aboutCard]}>
              <Text style={styles.sectionHeader}>About This Event</Text>
              <ExpandableText
                style={styles.bodyText}
                collapsedLines={3}
                moreLabel="Read More"
                inlineToggle
              >
                {event.description}
              </ExpandableText>
            </View>
          ) : null}

          <EventRouteCard event={event} location={location} />

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
            disabled={rsvpPending}
            accessibilityRole="button"
            accessibilityState={{ busy: rsvpPending, disabled: rsvpPending }}
            style={[
              styles.rsvpButton,
              { backgroundColor: isRsvped ? colors.info : colors.brand },
              rsvpPending ? { opacity: 0.75 } : null,
            ]}
          >
            <Text style={styles.rsvpButtonText}>{isRsvped ? "I'm Going" : 'RSVP'}</Text>
            {/*
              A spinner while the write is in flight. Without it the button held
              its resting state through the whole round trip, so a slow network
              looked exactly like a dead button -- the other half of LOOP-278's
              "app freezes when you try to RSVP".
              theme-exempt: sits on the filled button, white in both themes.
            */}
            {rsvpPending ? (
              <View style={{ marginLeft: 8 }}>
                <ActivityIndicator size="small" color="#fff" />
              </View>
            ) : isRsvped ? (
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
        onDismissed={handleOpenLinkDismissed}
      />

      {/* After returning from the browser: did you actually RSVP? */}
      <ConfirmModal
        visible={showDidYouRsvpModal}
        title="Did you RSVP?"
        body={`You clicked on the external link to RSVP for "${event.title}".`}
        emphasis="Were you able to RSVP through the external link?"
        primaryLabel="Yes"
        secondaryLabel="No"
        primaryDisabled={rsvpPending}
        onPrimary={() => {
          setShowDidYouRsvpModal(false);
          void confirmRsvp();
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
        primaryDisabled={rsvpPending}
        onPrimary={() => void confirmCancel()}
        onSecondary={() => setShowCancelModal(false)}
      />

      {shareNotice ? (
        <View pointerEvents="none" style={styles.sharePill}>
          <Text style={styles.sharePillText}>{shareNotice}</Text>
        </View>
      ) : null}

      {event.image_url ? (
        <FlyerFullscreenModal
          visible={flyerOpen}
          uri={event.image_url}
          onClose={() => setFlyerOpen(false)}
        />
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
  // Bare arrow on the hero, no disc behind it, as in the redesign.
  backButton: {
    position: 'absolute' as const,
    top: 12,
    left: 16,
    width: 40,
    height: 40,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 10,
  },
  expandButton: {
    position: 'absolute' as const,
    top: 12,
    right: 16,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: c.brandSoft,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    zIndex: 10,
  },
  // The white sheet that rides up over the bottom of the hero.
  sheet: {
    backgroundColor: c.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -24,
    paddingHorizontal: 20,
    paddingTop: 24,
    shadowColor: '#000', // theme-exempt: a shadow is black in both themes
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 6,
  },
  poster: {
    // Aspect ratio and width come from posterAspectRatio() / posterWidth() at render time.
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
    marginBottom: 12,
  },
  // Shared by the date/location card and the About card. surfaceMuted sits a
  // shade off the sheet's surface, with a soft shadow, as in the design.
  card: {
    backgroundColor: c.surfaceMuted,
    borderRadius: 12,
    marginBottom: 16,
    shadowColor: '#000', // theme-exempt: a shadow is black in both themes
    shadowOpacity: 0.06,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  aboutCard: {
    padding: 16,
  },
  cardDivider: {
    height: 1,
    backgroundColor: c.borderSoft,
    marginHorizontal: 12,
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
  categoryLine: {
    fontFamily: 'RobotoFlex_600SemiBold',
    fontSize: 12,
    fontWeight: '600' as const,
    letterSpacing: 0.5,
    color: c.brand,
    marginBottom: 8,
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
