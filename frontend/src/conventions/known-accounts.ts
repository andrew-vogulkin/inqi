/**
 * Accounts that have signed in on THIS device, most-recent first.
 *
 * inqi's sign-in is passwordless (email → one-time code), so the browser never sees a
 * password field and therefore never stores a credential — which is why it can't offer
 * the email back on the next visit. We remember it ourselves instead: pick your account
 * and go straight to the code, or add another one.
 *
 * Only the email is kept — never a token. The session lives in `session-storage`.
 */

const KEY = 'inqi.knownAccounts';
/** Enough for a shared laptop / a couple of work identities; the list stays scannable. */
export const MAX_KNOWN_ACCOUNTS = 5;

export interface KnownAccount {
  email: string;
  /** Epoch ms of the last successful sign-in — the list is ordered by this, newest first. */
  lastUsedAt: number;
}

/** Pure: put `email` at the head, de-duplicated (case-insensitively), capped. */
export function withAccount({ accounts, email, now }: { accounts: KnownAccount[]; email: string; now: number }): KnownAccount[] {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return accounts;
  const rest = accounts.filter((a) => a.email !== normalized);
  return [{ email: normalized, lastUsedAt: now }, ...rest].slice(0, MAX_KNOWN_ACCOUNTS);
}

/** Pure: drop one account ("forget me on this device" — it's a shared-computer affordance). */
export function withoutAccount({ accounts, email }: { accounts: KnownAccount[]; email: string }): KnownAccount[] {
  const normalized = email.trim().toLowerCase();
  return accounts.filter((a) => a.email !== normalized);
}

/** Pure: drop anything that isn't a `{email, lastUsedAt}` record — localStorage is user-writable. */
export function parseAccounts(raw: string | null): KnownAccount[] {
  try {
    const parsed: unknown = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((a): a is KnownAccount =>
        !!a && typeof a === 'object'
        && typeof (a as KnownAccount).email === 'string' && (a as KnownAccount).email.includes('@')
        && typeof (a as KnownAccount).lastUsedAt === 'number')
      .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .slice(0, MAX_KNOWN_ACCOUNTS);
  } catch {
    return [];
  }
}

export function getKnownAccounts(): KnownAccount[] {
  try {
    return parseAccounts(localStorage.getItem(KEY));
  } catch {
    return []; // storage blocked (private mode) — the sign-in form still works, just without memory
  }
}

function save(accounts: KnownAccount[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(accounts));
  } catch {
    // Blocked storage must never break sign-in; we simply don't remember this device.
  }
}

/** Record a SUCCESSFUL sign-in (call after the session commits — never on a mere attempt). */
export function rememberAccount({ email, now = Date.now() }: { email: string; now?: number }): KnownAccount[] {
  const next = withAccount({ accounts: getKnownAccounts(), email, now });
  save(next);
  return next;
}

/** Forget one account on this device (does not sign anyone out, does not touch the server). */
export function forgetAccount({ email }: { email: string }): KnownAccount[] {
  const next = withoutAccount({ accounts: getKnownAccounts(), email });
  save(next);
  return next;
}
