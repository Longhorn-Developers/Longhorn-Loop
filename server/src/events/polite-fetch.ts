// Shared HTTP helpers for scrapers.
//
// What this gives us:
//   - Exponential backoff on HTTP 429 (rate limited): 2s, 4s, 8s...
//   - Retry on network errors / thrown exceptions
//   - A consistent User-Agent identifying us as Longhorn Loop
//   - Throws on 4xx/5xx responses so callers can .catch() cleanly
//
// Sleep is exported for scrapers that need a delay between page fetches
// on top of the retry-side backoff.

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_USER_AGENT = 'LonghornLoop/1.0 (+https://longhornloop.app)';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface FetchWithRetryOptions {
  retries?: number;
  userAgent?: string;
  // Passed through to fetch(). Merged on top of the default Accept + UA.
  headers?: Record<string, string>;
}

export async function fetchWithRetry(
  url: string,
  options: FetchWithRetryOptions = {},
): Promise<Response> {
  const retries = options.retries ?? DEFAULT_MAX_RETRIES;
  const userAgent = options.userAgent ?? DEFAULT_USER_AGENT;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': userAgent,
          ...options.headers,
        },
      });

      if (res.status === 429) {
        const backoff = Math.pow(2, attempt) * 2000;
        console.log(`[polite-fetch] 429 from ${url}, backing off ${backoff}ms...`);
        await sleep(backoff);
        continue;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return res;
    } catch (err) {
      if (attempt === retries - 1) throw err;
      const backoff = Math.pow(2, attempt) * 1000;
      console.log(
        `[polite-fetch] attempt ${attempt + 1} failed for ${url}, retrying in ${backoff}ms...`,
      );
      await sleep(backoff);
    }
  }
  throw new Error('All retries exhausted');
}
