import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { StoredSession } from './session-storage';

const SESSION: StoredSession = { token: 'tok123', customer: { id: 'c1', email: 'a@x.io', role: 'customer' as StoredSession['customer']['role'] } };

describe('session-storage — synchronous cache + resilient persistence', () => {
  let store: Record<string, string>;
  let throwOnSet: boolean;

  beforeEach(() => {
    store = {};
    throwOnSet = false;
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => { if (throwOnSet) throw new Error('storage blocked'); store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    vi.resetModules(); // fresh module → in-memory cache starts unhydrated
  });

  const load = () => import('./session-storage');

  it('reads the token back SYNCHRONOUSLY after setStoredSession (no refresh needed)', async () => {
    const s = await load();
    s.setStoredSession(SESSION);
    expect(s.getStoredSession()).toEqual(SESSION);              // from the in-memory cache
    expect(JSON.parse(store['inqi.session'])).toEqual(SESSION); // and persisted for a refresh
  });

  it('hydrates from localStorage on first read (a refresh stays signed in)', async () => {
    store['inqi.session'] = JSON.stringify(SESSION);
    const s = await load();
    expect(s.getStoredSession()).toEqual(SESSION);
  });

  it('keeps the session in memory when localStorage.setItem throws (iOS private browsing)', async () => {
    const s = await load();
    throwOnSet = true;
    expect(() => s.setStoredSession(SESSION)).not.toThrow();
    expect(s.getStoredSession()).toEqual(SESSION); // still signed in for this tab
  });

  it('setStoredSession(null) clears the cache and storage', async () => {
    const s = await load();
    s.setStoredSession(SESSION);
    s.setStoredSession(null);
    expect(s.getStoredSession()).toBeNull();
    expect(store['inqi.session']).toBeUndefined();
  });
});
