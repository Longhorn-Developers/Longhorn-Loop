// Server-side helpers for the Linked Socials feature (LOOP-181).
//
// Format validation lives in shared/socialPlatforms.ts so the client can run
// the exact same check without a round trip. This file adds the part that can
// only happen server-side: a best-effort reachability probe backing the
// "Instagram link was not found" error state in the Figma flow.

import { validateSocialUrl } from '../../../shared/socialPlatforms';

export {
  MAX_LINKED_SOCIALS,
  isSocialPlatformId,
  validateSocialUrl,
} from '../../../shared/socialPlatforms';

/** How long we'll wait on a social host before giving up and allowing the link. */
const PROBE_TIMEOUT_MS = 4000;

export type ProbeResult = 'ok' | 'not_found' | 'unknown';

/**
 * Best-effort check that a social URL actually resolves to something.
 *
 * Deliberately conservative: this returns 'not_found' ONLY on a definitive
 * 404/410 from the host. Timeouts, DNS failures, 403s and rate limits all
 * return 'unknown', and callers treat 'unknown' as acceptable.
 *
 * The reason is asymmetric cost. Instagram and LinkedIn aggressively block
 * datacenter egress -- a Cloudflare Worker hitting them gets 403s and login
 * walls for profiles that exist and are perfectly valid. Treating those as
 * failures would reject correct links for most users, which is far worse than
 * occasionally storing a dead one. The format check in validateSocialUrl is
 * what does the real work; this only catches the clear-cut typo case.
 */
export async function probeSocialUrl(url: string): Promise<ProbeResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);

  try {
    // HEAD first: cheapest possible request. Some hosts reject HEAD with 405,
    // in which case we fall through to GET rather than calling it a failure.
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(url, { method: 'GET', redirect: 'follow', signal: controller.signal });
      }
    } catch {
      return 'unknown';
    }

    if (res.status === 404 || res.status === 410) return 'not_found';
    return 'ok';
  } catch {
    return 'unknown';
  } finally {
    clearTimeout(timeout);
  }
}

/** Maps a validateSocialUrl() error code to the copy the client should show. */
export function socialUrlErrorMessage(error: string, platformLabel: string): string {
  switch (error) {
    case 'EMPTY':
      return 'Enter a link.';
    case 'WRONG_HOST':
      return `That doesn't look like a ${platformLabel} link.`;
    case 'UNSUPPORTED_SCHEME':
      return 'Links must start with http or https.';
    case 'UNKNOWN_PLATFORM':
      return 'That app isn’t supported.';
    case 'MALFORMED':
    default:
      return 'That link isn’t formatted correctly.';
  }
}
