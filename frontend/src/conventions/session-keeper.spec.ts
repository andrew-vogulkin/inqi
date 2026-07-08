import { describe, it, expect } from 'vitest';
import { decodeExpMs, nextRefreshDelayMs, refreshDelayForToken, shouldRefreshNow, REFRESH_SKEW_MS, MIN_REFRESH_DELAY_MS, DEFAULT_REFRESH_DELAY_MS } from './session-keeper';

/** Build a JWT-shaped token whose payload carries `exp` (seconds), base64url. */
function tokenWithExp(expSeconds: number | undefined): string {
  const b64url = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64url({ alg: 'HS256' })}.${b64url({ sub: 'c1', exp: expSeconds })}.sig`;
}

describe('session-keeper', () => {
  describe('decodeExpMs', () => {
    it('reads exp (ms) from a token payload', () => {
      expect(decodeExpMs(tokenWithExp(1_700_000_000))).toBe(1_700_000_000_000);
    });
    it('returns null for a token without exp or a malformed token', () => {
      expect(decodeExpMs(tokenWithExp(undefined))).toBeNull();
      expect(decodeExpMs('not-a-jwt')).toBeNull();
      expect(decodeExpMs('')).toBeNull();
    });
  });

  describe('nextRefreshDelayMs', () => {
    it('schedules the refresh REFRESH_SKEW_MS before expiry', () => {
      const now = 1_000_000;
      const expMs = now + 8 * 3600_000; // 8h out
      expect(nextRefreshDelayMs({ expMs, now })).toBe(8 * 3600_000 - REFRESH_SKEW_MS);
    });
    it('never returns below the floor (token already near/past expiry)', () => {
      const now = 1_000_000;
      expect(nextRefreshDelayMs({ expMs: now, now })).toBe(MIN_REFRESH_DELAY_MS);
      expect(nextRefreshDelayMs({ expMs: now - 10_000, now })).toBe(MIN_REFRESH_DELAY_MS);
    });
  });

  describe('refreshDelayForToken', () => {
    it('uses the token expiry when readable', () => {
      const now = 1_000_000;
      const token = tokenWithExp((now + 8 * 3600_000) / 1000);
      expect(refreshDelayForToken({ token, now })).toBe(8 * 3600_000 - REFRESH_SKEW_MS);
    });
    it('falls back to the default cadence for an unreadable token', () => {
      expect(refreshDelayForToken({ token: 'not-a-jwt', now: 1_000_000 })).toBe(DEFAULT_REFRESH_DELAY_MS);
    });
  });

  describe('shouldRefreshNow', () => {
    it('is true only once inside the skew window', () => {
      const now = 1_000_000;
      expect(shouldRefreshNow({ expMs: now + 8 * 3600_000, now })).toBe(false); // fresh
      expect(shouldRefreshNow({ expMs: now + REFRESH_SKEW_MS - 1, now })).toBe(true); // nearly due
      expect(shouldRefreshNow({ expMs: now - 1, now })).toBe(true); // past
    });
  });
});
