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
}

interface RequestOptions {
  token?: string | null;
  body?: unknown;
  signal?: AbortSignal;
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;

  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });

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

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, opts?: RequestOptions) => request<T>('POST', path, opts),
  put: <T>(path: string, opts?: RequestOptions) => request<T>('PUT', path, opts),
  patch: <T>(path: string, opts?: RequestOptions) => request<T>('PATCH', path, opts),
  delete: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
