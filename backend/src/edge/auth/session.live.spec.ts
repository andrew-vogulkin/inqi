/**
 * LIVE end-to-end SESSION test (opt-in): drives the REAL running backend over HTTP
 * and verifies the session token's lifetime + prolongation:
 *   - sign-in issues a token whose expiry is SESSION_TTL_HOURS (8h) from issue,
 *   - POST /auth/refresh prolongs it (a later, still-full-TTL token that authenticates),
 *   - refresh is guarded (no/forged token → 401).
 *
 * Skipped by default so the normal suite stays offline. Run it explicitly:
 *   LIVE_SESSION=1 pnpm --filter @inqi/backend test session.live
 *
 * Requirements: the backend is up (INQI_BASE_URL, default http://localhost:4000)
 * and running with MOCK MFA (MFA_TRANSPORT=mock, the default) so sign-in can use the
 * fixed code. Set SESSION_TTL_HOURS here to match the backend if you overrode it.
 */
export {}; // module scope — keeps top-level names off the global (shared with authz.live.spec)

const LIVE = process.env.LIVE_SESSION === '1';
const BASE = process.env.INQI_BASE_URL ?? 'http://localhost:4000';
const MFA_CODE = process.env.MFA_MOCK_CODE ?? '123456';
const TTL_HOURS = Number(process.env.SESSION_TTL_HOURS ?? 8);
const EMAIL = process.env.SESSION_E2E_EMAIL ?? 'session.e2e@inqi.example';

interface TokenPayload { sub: string; email: string; role: string; iat: number; exp: number }
const decode = (token: string): TokenPayload => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function api(path: string, { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* empty body is fine for status asserts */ }
  return { status: res.status, json: json as Record<string, unknown> };
}

async function signIn(email: string): Promise<string> {
  const start = await api('/auth/email', { method: 'POST', body: { email } });
  expect(start.status).toBeLessThan(300);
  const verify = await api('/auth/email/verify', { method: 'POST', body: { email, code: MFA_CODE } });
  expect(verify.status).toBeLessThan(300);
  return (verify.json as { token: string }).token;
}

(LIVE ? describe : describe.skip)('SESSION live e2e — 8h expiry + prolongation', () => {
  it('sign-in issues a token that expires SESSION_TTL_HOURS from issue', async () => {
    const token = await signIn(EMAIL);
    const p = decode(token);
    expect(p.email).toBe(EMAIL);
    expect(p.exp - p.iat).toBe(TTL_HOURS * 3600);
    expect(p.exp * 1000).toBeGreaterThan(Date.now()); // not already expired
  });

  it('the token authenticates GET /auth/me', async () => {
    const token = await signIn(EMAIL);
    const me = await api('/auth/me', { token });
    expect(me.status).toBe(200);
    expect(me.json.email).toBe(EMAIL);
  });

  it('POST /auth/refresh prolongs the session — a later, full-TTL token that still authenticates', async () => {
    const first = await signIn(EMAIL);
    const p1 = decode(first);
    await sleep(1100); // let the wall clock advance so the new exp is strictly later
    const res = await api('/auth/refresh', { method: 'POST', token: first });
    expect(res.status).toBeLessThan(300);
    const second = (res.json as { token: string }).token;
    const p2 = decode(second);
    expect(second).not.toBe(first);
    expect(p2.exp).toBeGreaterThan(p1.exp);          // prolonged
    expect(p2.exp - p2.iat).toBe(TTL_HOURS * 3600);  // fresh full-TTL window
    const me = await api('/auth/me', { token: second });
    expect(me.status).toBe(200);
    expect(me.json.sub).toBe(p1.sub);                // same principal
  });

  it('refresh is guarded — no token and a forged token both 401', async () => {
    const noToken = await api('/auth/refresh', { method: 'POST' });
    expect(noToken.status).toBe(401);
    const forged = await api('/auth/refresh', { method: 'POST', token: 'aaa.bbb.ccc' });
    expect(forged.status).toBe(401);
  });
});
