import { MfaCodeStore } from './mfa-code.store';

describe('MfaCodeStore', () => {
  const email = 'ada@example.com';
  const TTL = 10 * 60_000;

  it('issues a 6-digit code that verifies once, then is consumed', () => {
    const store = new MfaCodeStore();
    const code = store.issue({ email, ttlMs: TTL, now: 1_000 });
    expect(code).toMatch(/^\d{6}$/);
    expect(store.verify({ email, code, now: 2_000 })).toBe(true);
    expect(store.verify({ email, code, now: 3_000 })).toBe(false); // single-use
  });

  it('rejects an unknown email and a wrong code', () => {
    const store = new MfaCodeStore();
    expect(store.verify({ email, code: '000000', now: 1 })).toBe(false); // never issued
    const code = store.issue({ email, ttlMs: TTL, now: 1_000 });
    const wrong = code === '111111' ? '222222' : '111111';
    expect(store.verify({ email, code: wrong, now: 2_000 })).toBe(false);
  });

  it('rejects an expired code', () => {
    const store = new MfaCodeStore();
    const code = store.issue({ email, ttlMs: TTL, now: 1_000 });
    expect(store.verify({ email, code, now: 1_000 + TTL + 1 })).toBe(false);
  });

  it('burns the code after 5 wrong attempts (brute-force guard)', () => {
    const store = new MfaCodeStore();
    const code = store.issue({ email, ttlMs: TTL, now: 1_000 });
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 5; i++) expect(store.verify({ email, code: wrong, now: 2_000 })).toBe(false);
    expect(store.verify({ email, code, now: 2_000 })).toBe(false); // correct code no longer works
  });

  it('re-issuing replaces the prior code', () => {
    const store = new MfaCodeStore();
    const first = store.issue({ email, ttlMs: TTL, now: 1_000 });
    const second = store.issue({ email, ttlMs: TTL, now: 1_500 });
    if (first !== second) expect(store.verify({ email, code: first, now: 2_000 })).toBe(false);
    expect(store.verify({ email, code: second, now: 2_000 })).toBe(true);
  });
});
