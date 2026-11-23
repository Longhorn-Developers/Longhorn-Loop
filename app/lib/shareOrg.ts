// Sharing an org page out of the app (LOOP-335, the org page's ••• sheet).
//
// Same shape as shareEvent.ts, minus its external-URL preference: orgs have no
// public page of their own outside Loop, so the link is always the deep link
// to /org/:id/profile -- the page everyone, member or not, lands on.
//
// Copy Link is web-only. Native has no clipboard module in this app
// (expo-clipboard isn't a dependency, and React Native's own was removed), and
// both platforms' share sheets already offer "Copy", so a native Copy Link row
// would be a second, worse route to the same place.

import * as Linking from 'expo-linking';
import { Platform, Share } from 'react-native';

export type OrgShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

export function orgShareUrl(orgId: number): string {
  return Linking.createURL(`/org/${orgId}/profile`);
}

function webNavigator(): Navigator | undefined {
  return typeof navigator === 'undefined' ? undefined : (navigator as Navigator);
}

/** Whether a "Copy Link" row can work on this platform. */
export function canCopyOrgLink(): boolean {
  return Platform.OS === 'web' && !!webNavigator()?.clipboard?.writeText;
}

export async function copyOrgLink(orgId: number): Promise<OrgShareOutcome> {
  const nav = webNavigator();
  if (!nav?.clipboard?.writeText) return 'failed';
  try {
    await nav.clipboard.writeText(orgShareUrl(orgId));
    return 'copied';
  } catch {
    return 'failed';
  }
}

export async function shareOrg(org: { id: number; name: string }): Promise<OrgShareOutcome> {
  const url = orgShareUrl(org.id);
  const summary = `${org.name} on Longhorn Loop`;

  if (Platform.OS === 'web') {
    const nav = webNavigator();
    if (nav && typeof nav.share === 'function') {
      try {
        await nav.share({ title: org.name, text: summary, url });
        return 'shared';
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return 'dismissed';
      }
    }
    return copyOrgLink(org.id);
  }

  try {
    const result = await Share.share(
      Platform.OS === 'ios'
        ? { message: summary, url }
        : // Android reads only `message`, so the URL has to ride inside it.
          { message: `${summary}\n\n${url}`, title: org.name },
      { dialogTitle: `Share ${org.name}` },
    );
    return result.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch (err) {
    console.warn('Share failed', err);
    return 'failed';
  }
}
