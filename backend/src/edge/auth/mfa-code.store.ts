import { Injectable } from '@nestjs/common';
import { randomInt } from 'crypto';

interface Entry { code: string; expiresAt: number; attempts: number }

/** Max verify attempts per issued code before it's burned (brute-force guard). */
const MAX_ATTEMPTS = 5;

/**
 * In-memory one-time MFA code store, keyed by (normalized) email. Single-use,
 * TTL-bounded, attempt-limited. Deliberately in-memory: this backs the `email`
 * MFA transport for local/single-instance dev — codes don't survive a restart
 * and aren't shared across instances (fine for that scope; a multi-instance
 * deployment would swap this for a Redis/DB-backed store behind the same shape).
 */
@Injectable()
export class MfaCodeStore {
  private readonly codes = new Map<string, Entry>();

  /** Issue (and store) a fresh 6-digit code for `email`, replacing any prior one. */
  issue({ email, ttlMs, now }: { email: string; ttlMs: number; now: number }): string {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(email, { code, expiresAt: now + ttlMs, attempts: 0 });
    return code;
  }

  /**
   * Verify `code` for `email`. Consumes the code on success; on failure counts an
   * attempt and burns the code once MAX_ATTEMPTS is reached. Expired/absent → false.
   */
  verify({ email, code, now }: { email: string; code: string; now: number }): boolean {
    const entry = this.codes.get(email);
    if (!entry) return false;
    if (now > entry.expiresAt) { this.codes.delete(email); return false; }
    if (entry.code === code) { this.codes.delete(email); return true; }
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) this.codes.delete(email);
    return false;
  }
}
