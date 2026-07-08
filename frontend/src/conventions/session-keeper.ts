/**
 * Session prolongation helpers (pure). The app renews its token before the ~8h
 * server TTL lapses by calling POST /auth/refresh; these compute WHEN. Kept pure +
 * side-effect-free so the scheduling policy is unit-tested; the timer/effect that
 * uses them lives in App.tsx.
 */

/** Renew this long BEFORE the token's expiry, so an in-flight renewal never races the lapse. */
export const REFRESH_SKEW_MS = 5 * 60_000; // 5 minutes
/** Floor on the scheduled delay — never spin when a token is already near/past expiry. */
export const MIN_REFRESH_DELAY_MS = 10_000; // 10 seconds

/** Decode a session token's expiry (ms epoch) from its JWT payload, or null if unreadable. */
export function decodeExpMs(token: string): number | null {
  const seg = token.split('.')[1];
  if (!seg) return null;
  try {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))
        .split('')
        .map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0'))
        .join(''),
    );
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' ? exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Fallback cadence when a token's expiry can't be read (well under the 8h TTL). */
export const DEFAULT_REFRESH_DELAY_MS = 4 * 3600_000; // 4 hours

/** Delay until the next proactive refresh: `skew` before expiry, floored so it never busy-loops. */
export function nextRefreshDelayMs({ expMs, now }: { expMs: number; now: number }): number {
  return Math.max(MIN_REFRESH_DELAY_MS, expMs - now - REFRESH_SKEW_MS);
}

/** Delay to the next refresh for a whole token — decodes its expiry, or falls back to the default cadence. */
export function refreshDelayForToken({ token, now }: { token: string; now: number }): number {
  const expMs = decodeExpMs(token);
  return expMs == null ? DEFAULT_REFRESH_DELAY_MS : nextRefreshDelayMs({ expMs, now });
}

/** Should a focus/visibility event trigger an eager refresh? True once the token is inside the skew window. */
export function shouldRefreshNow({ expMs, now }: { expMs: number; now: number }): boolean {
  return expMs - now <= REFRESH_SKEW_MS;
}
