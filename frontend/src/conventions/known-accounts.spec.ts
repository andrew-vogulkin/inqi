import { describe, expect, it } from 'vitest';
import { MAX_KNOWN_ACCOUNTS, parseAccounts, withAccount, withoutAccount } from './known-accounts';

const at = (email: string, lastUsedAt: number) => ({ email, lastUsedAt });

describe('known-accounts — the device-local sign-in memory', () => {
  it('puts the newest sign-in first', () => {
    const next = withAccount({ accounts: [at('a@x.io', 1)], email: 'b@x.io', now: 2 });
    expect(next.map((a) => a.email)).toEqual(['b@x.io', 'a@x.io']);
  });

  it('re-signing in with a known account moves it back to the top, without duplicating it', () => {
    const next = withAccount({ accounts: [at('a@x.io', 1), at('b@x.io', 2)], email: 'a@x.io', now: 3 });
    expect(next.map((a) => a.email)).toEqual(['a@x.io', 'b@x.io']);
    expect(next[0].lastUsedAt).toBe(3);
  });

  it('normalizes the address, so Ada@X.io and ada@x.io are one account', () => {
    const next = withAccount({ accounts: [at('ada@x.io', 1)], email: '  Ada@X.io  ', now: 2 });
    expect(next).toHaveLength(1);
    expect(next[0].email).toBe('ada@x.io');
  });

  it(`keeps at most ${MAX_KNOWN_ACCOUNTS}, dropping the least recently used`, () => {
    let accounts = [] as ReturnType<typeof withAccount>;
    for (let i = 0; i < MAX_KNOWN_ACCOUNTS + 3; i++) accounts = withAccount({ accounts, email: `u${i}@x.io`, now: i });
    expect(accounts).toHaveLength(MAX_KNOWN_ACCOUNTS);
    expect(accounts[0].email).toBe(`u${MAX_KNOWN_ACCOUNTS + 2}@x.io`); // newest
    expect(accounts.some((a) => a.email === 'u0@x.io')).toBe(false);   // oldest evicted
  });

  it('ignores an empty address (a blank submit must not create a ghost row)', () => {
    const accounts = [at('a@x.io', 1)];
    expect(withAccount({ accounts, email: '   ', now: 2 })).toEqual(accounts);
  });

  it('forgets one account and leaves the rest', () => {
    const next = withoutAccount({ accounts: [at('a@x.io', 1), at('b@x.io', 2)], email: 'A@X.io' });
    expect(next.map((a) => a.email)).toEqual(['b@x.io']);
  });
});

describe('known-accounts — parsing what is in localStorage', () => {
  it('reads a stored list newest-first', () => {
    expect(parseAccounts(JSON.stringify([at('a@x.io', 1), at('b@x.io', 9)])).map((a) => a.email))
      .toEqual(['b@x.io', 'a@x.io']);
  });

  // localStorage is user-writable: anything in there is untrusted input, and a throw here
  // would take the whole sign-in screen down.
  it('survives garbage: malformed JSON, wrong shapes, non-arrays', () => {
    expect(parseAccounts('not json')).toEqual([]);
    expect(parseAccounts(null)).toEqual([]);
    expect(parseAccounts('{"nope":1}')).toEqual([]);
    expect(parseAccounts(JSON.stringify(['a@x.io', 42, null, { email: 'no-at-sign', lastUsedAt: 1 }, { email: 'ok@x.io' }])))
      .toEqual([]);
  });

  it('keeps the valid entries and drops only the malformed ones', () => {
    expect(parseAccounts(JSON.stringify([{ email: 'ok@x.io', lastUsedAt: 5 }, { email: 'bad' }])).map((a) => a.email))
      .toEqual(['ok@x.io']);
  });
});
