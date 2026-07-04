import { getStoredSession } from '../conventions/session-storage';
import { ApiError, ApiErrorCode, friendlyMessage, statusToCode } from './errors';

const BASE = '/api';

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 300;

/**
 * App-wide 401 handler (FE-02). The store registers a callback that clears the
 * session + routes to Sign in; the client invokes it on any 401 so an expired/invalid
 * session anywhere bounces the user back to Sign in.
 */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void { onUnauthorized = fn; }

/** HTTP verbs (convention #1: no bare method strings). */
export const HttpMethod = { Get: 'GET', Post: 'POST', Patch: 'PATCH', Delete: 'DELETE' } as const;
export type HttpMethod = (typeof HttpMethod)[keyof typeof HttpMethod];

export type QueryValue = string | number | boolean | undefined | null;

export interface RequestArgs {
  method: HttpMethod;
  path: string;
  /** Querystring params (serialized + encoded). Never put PII here. */
  query?: Record<string, QueryValue>;
  body?: unknown;
  auth?: boolean; // attach the Bearer session (default true)
  signal?: AbortSignal; // AbortController cancellation
  /** Bounded retry — only fires when the error is `retryable` (and GET network errors). */
  retry?: { maxRetries?: number; baseDelayMs?: number };
}

/** Serialize a query map to `?a=1&b=2`, skipping undefined/null (URL-encoded). */
export function serializeQuery(query?: Record<string, QueryValue>): string {
  if (!query) return '';
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `?${s}` : '';
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** A single attempt: attach the token, fetch, parse the envelope, throw {@link ApiError}. */
async function attempt<T>({ method, path, query, body, auth = true, signal }: RequestArgs): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (auth) {
    const session = getStoredSession();
    if (session?.token) headers['authorization'] = `Bearer ${session.token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}${serializeQuery(query)}`, {
      method, headers, signal,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    // The request never reached the server. Idempotent GETs are safe to retry.
    throw new ApiError({ code: ApiErrorCode.Network, httpStatus: 0, retryable: method === HttpMethod.Get });
  }

  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = null; }

  if (!res.ok) {
    // App-wide 401 = a dead SESSION on an authenticated call. Unauthenticated calls
    // (the sign-in endpoints themselves) surface their 401 normally — a wrong MFA
    // code must show as an error, not bounce the flow back to the email step.
    if (res.status === 401 && auth) onUnauthorized?.();
    const env = (json as { error?: { code?: string; message?: string; retryable?: boolean; details?: Record<string, unknown> } } | null)?.error;
    const code = env?.code ?? statusToCode(res.status);
    throw new ApiError({
      code,
      message: env?.message ?? friendlyMessage(code),
      retryable: env?.retryable,
      details: env?.details,
      httpStatus: res.status,
    });
  }
  return json as T;
}

/**
 * The ONE place the app calls `fetch` (convention #4). Attaches the session token,
 * serializes the query, parses the typed error envelope, and throws {@link ApiError}.
 * Retries **only** when the server marks the error `retryable` (or a GET fails to reach
 * the server) — mutations are never retried blindly — with bounded exponential backoff.
 */
export async function request<T>(args: RequestArgs): Promise<T> {
  const maxRetries = args.retry?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = args.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  let attemptNo = 0;
  for (;;) {
    try {
      return await attempt<T>(args);
    } catch (err) {
      const e = err as ApiError;
      const canRetry = attemptNo < maxRetries && e instanceof ApiError && e.retryable === true;
      if (!canRetry) throw e;
      await sleep(baseDelayMs * 2 ** attemptNo);
      attemptNo += 1;
    }
  }
}
