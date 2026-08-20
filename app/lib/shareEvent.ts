// Sharing an event out of the app.
//
// The link we hand out prefers the event's own public page (`event_url`), so
// whoever receives it can open it without having Longhorn Loop installed.
// Events created in-app have no external page, so those fall back to a deep
// link built from the Expo scheme, which routes straight to /event/:id.
//
// Web has no React Native Share module, so it uses the browser's Web Share API
// where one exists and drops to a clipboard copy otherwise. Callers get the
// outcome back so they can say "Link copied" instead of silently doing nothing.

import type { ApiEvent } from '@/app/components/EventCard';
import { formatEventDate } from '@/app/components/EventCard';
import * as Linking from 'expo-linking';
import { Platform, Share } from 'react-native';

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

// Only the fields sharing actually reads, so this is usable from event cards
// and search results too, not just the detail screen.
export type ShareableEvent = Pick<
  ApiEvent,
  'id' | 'title' | 'start_datetime' | 'location_short' | 'location_full' | 'event_url'
>;

export function eventShareUrl(event: ShareableEvent): string {
  const external = event.event_url?.trim();
  return external || Linking.createURL(`/event/${event.id}`);
}

// Title / date / location, without the URL. iOS wants the link as its own
// activity item rather than buried in the message body.
export function buildEventShareSummary(event: ShareableEvent): string {
  const where = event.location_short || event.location_full;
  const lines = [event.title, formatEventDate(event.start_datetime)];
  if (where) lines.push(where);
  return lines.join('\n');
}

// The everything-in-one-string form, for Android and for clipboard fallback.
export function buildEventShareMessage(event: ShareableEvent): string {
  return `${buildEventShareSummary(event)}\n\n${eventShareUrl(event)}`;
}

async function shareOnWeb(event: ShareableEvent): Promise<ShareOutcome> {
  const nav = typeof navigator === 'undefined' ? undefined : (navigator as Navigator);

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({
        title: event.title,
        text: buildEventShareSummary(event),
        url: eventShareUrl(event),
      });
      return 'shared';
    } catch (err) {
      // The user closing the sheet throws AbortError; anything else means the
      // API is unusable here (no HTTPS, no user gesture) so we keep going and
      // try the clipboard.
      if ((err as Error)?.name === 'AbortError') return 'dismissed';
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(buildEventShareMessage(event));
      return 'copied';
    } catch {
      return 'failed';
    }
  }

  return 'failed';
}

export async function shareEvent(event: ShareableEvent): Promise<ShareOutcome> {
  if (Platform.OS === 'web') return shareOnWeb(event);

  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { message: buildEventShareSummary(event), url: eventShareUrl(event) }
        : // Android reads only `message`, so the URL has to stay inside it.
          { message: buildEventShareMessage(event), title: event.title },
      { dialogTitle: `Share ${event.title}` },
    );

    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch (err) {
    console.warn('Share failed', err);
    return 'failed';
  }
}
