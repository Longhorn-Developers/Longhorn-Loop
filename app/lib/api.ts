// Thin wrapper around fetch() so query/mutation functions don't repeat
// the auth-header + JSON-parsing + error-throwing dance.
//
// Use this from inside React Query's `queryFn` / `mutationFn`:
//
//   useQuery({
//     queryKey: events.list(),
//     queryFn: () => api.get<EventsResponse>('/events', { token }),
//   });

import { API_BASE_URL } from '@/app/config/api';

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }

  /** True when the request never reached the server at all. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

/**
 * React Native reports every unreachable-server case -- wrong host, server not
 * running, phone on a different Wi-Fi network, no connectivity -- as the same
 * opaque `TypeError: Network request failed`, with no mention of the URL it
 * tried. That is what made "it works in the browser but not on my phone" so
 * hard to pin down. Wrap it in an ApiError that at least names the target.
 *
 * status 0 means "never got a response", which is distinct from any real HTTP
 * status and is what `isNetworkError` keys off.
 */
function toNetworkError(err: unknown): ApiError {
  const hint = __DEV__
    ? ` Could not reach ${API_BASE_URL} — check that the Worker is running (\`npm run dev:lan\` in /server) and that this device is on the same network as the dev machine.`
    : ' Check your internet connection and try again.';

  return new ApiError(0, err, `Network request failed.${hint}`);
}

/** Aborts are the caller's own doing, so they pass through untouched. */
function isAbort(err: unknown): boolean {
  return (err as { name?: string } | null)?.name === 'AbortError';
}

interface RequestOptions {
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
}

interface FormRequestOptions {
  token?: string | null;
  signal?: AbortSignal;
}

async function parseResponse<T>(res: Response): Promise<T> {
  // Try to parse JSON, but tolerate empty bodies / non-JSON errors.
  let parsed: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!res.ok) {
    const message =
      (parsed && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as Record<string, unknown>).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, parsed, message);
  }

  return parsed as T;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw toNetworkError(err);
  }

  return parseResponse<T>(res);
}

async function requestForm<T>(
  method: 'POST' | 'PUT' | 'PATCH',
  path: string,
  form: FormData,
  opts: FormRequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: form,
      signal: opts.signal,
    });
  } catch (err) {
    if (isAbort(err)) throw err;
    throw toNetworkError(err);
  }

  return parseResponse<T>(res);
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  postForm: <T>(path: string, form: FormData, opts?: FormRequestOptions) =>
    requestForm<T>('POST', path, form, opts),
  put: <T>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
  patch: <T>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
