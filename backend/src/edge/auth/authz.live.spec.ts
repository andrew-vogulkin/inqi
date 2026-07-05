/**
 * LIVE end-to-end AUTHN/AUTHZ test (opt-in): drives the REAL running backend over
 * HTTP with two REAL signed-in users and verifies cross-user access is impossible
 * on the main API surface — reports (list/detail/live/provenance/unlock) and
 * emails (the /comms thread API + the chain embedded in provenance).
 *
 * Skipped by default so the normal suite stays offline. Run it explicitly:
 *   LIVE_AUTHZ=1 pnpm --filter @inqi/backend test authz
 *
 * Requirements: the backend is up (INQI_BASE_URL, default http://localhost:4000)
 * and OWNER_EMAIL (default andrei@codemonkey.io) owns at least one report with
 * ranked options. The intruder account is created on the fly by the sign-in flow.
 */
const LIVE = process.env.LIVE_AUTHZ === '1';
const BASE = process.env.INQI_BASE_URL ?? 'http://localhost:4000';
const MFA_CODE = process.env.MFA_MOCK_CODE ?? '123456';
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'andrei@codemonkey.io';
const INTRUDER_EMAIL = 'authz.intruder@e2e.inqi.example';

interface Session { token: string; customer: { id: string; email: string; role: string } }

async function api(path: string, { method = 'GET', token, body }: { method?: string; token?: string; body?: unknown } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON body (empty) is fine for status asserts */ }
  return { status: res.status, json: json as Record<string, never> & Record<string, unknown> };
}

async function signIn(email: string): Promise<Session> {
  const start = await api('/auth/email', { method: 'POST', body: { email } });
  expect(start.status).toBeLessThan(300);
  const verify = await api('/auth/email/verify', { method: 'POST', body: { email, code: MFA_CODE } });
  expect(verify.status).toBeLessThan(300);
  return verify.json as unknown as Session;
}

(LIVE ? describe : describe.skip)('AUTHN/AUTHZ live e2e — reports & emails are owner-scoped', () => {
  jest.setTimeout(180_000);

  let owner: Session;
  let intruder: Session;
  let reportId: string;          // a report OWNED by the owner
  let optionRef: string;         // one of its ranked options (provenance target)
  let snapshotId: string | null; // its delivered snapshot (unlock target)

  beforeAll(async () => {
    owner = await signIn(OWNER_EMAIL);
    intruder = await signIn(INTRUDER_EMAIL);

    // Pick an owner report that already has ranked options (any delivered run).
    const list = await api('/reports', { token: owner.token });
    expect(list.status).toBe(200);
    const reports = list.json as unknown as { id: string }[];
    expect(reports.length).toBeGreaterThan(0);
    for (const r of reports) {
      const live = await api(`/reports/${r.id}/live`, { token: owner.token });
      const options = (live.json?.options ?? []) as { subjectProvider: string }[];
      if (live.status === 200 && options.length) {
        reportId = r.id;
        optionRef = options[0].subjectProvider;
        snapshotId = (live.json?.snapshotId as string | null) ?? null;
        break;
      }
    }
    expect(reportId).toBeDefined();
  });

  describe('authentication', () => {
    it('rejects requests without a token (401)', async () => {
      expect((await api('/reports')).status).toBe(401);
      expect((await api(`/reports/x/live`)).status).toBe(401);
      expect((await api('/comms/thread/x')).status).toBe(401);
    });

    it('rejects a forged bearer token (401)', async () => {
      const r = await api('/reports', { token: 'forged.token.value' });
      expect(r.status).toBe(401);
    });

    it('rejects a wrong MFA code (401, no session issued)', async () => {
      const r = await api('/auth/email/verify', { method: 'POST', body: { email: INTRUDER_EMAIL, code: '000000' } });
      expect(r.status).toBe(401);
      expect(r.json?.token).toBeUndefined();
    });

    it('issues sessions bound to the right principal', async () => {
      const me = await api('/auth/me', { token: intruder.token });
      expect(me.status).toBe(200);
      expect(me.json?.email).toBe(INTRUDER_EMAIL);
      expect(me.json?.role).toBe('customer'); // a fresh sign-up never arrives privileged
    });
  });

  describe('authorization — reports', () => {
    it("the intruder's report list never contains the owner's report", async () => {
      const r = await api('/reports', { token: intruder.token });
      expect(r.status).toBe(200);
      expect((r.json as unknown as { id: string }[]).map((x) => x.id)).not.toContain(reportId);
    });

    it("report detail: 404 for the intruder (no existence leak), 200 for the owner", async () => {
      expect((await api(`/reports/${reportId}`, { token: intruder.token })).status).toBe(404);
      expect((await api(`/reports/${reportId}`, { token: owner.token })).status).toBe(200);
    });

    it('live report: 404 for the intruder, 200 with options for the owner', async () => {
      expect((await api(`/reports/${reportId}/live`, { token: intruder.token })).status).toBe(404);
      const own = await api(`/reports/${reportId}/live`, { token: owner.token });
      expect(own.status).toBe(200);
      expect((own.json?.options as unknown[]).length).toBeGreaterThan(0);
    });

    it('option provenance (carries the email chain): 404 for the intruder, chain only for the owner', async () => {
      const ref = encodeURIComponent(optionRef);
      const stolen = await api(`/reports/${reportId}/options/${ref}/provenance`, { token: intruder.token });
      expect(stolen.status).toBe(404);
      expect(stolen.json?.outreach).toBeUndefined(); // nothing of the conversation leaks
      const own = await api(`/reports/${reportId}/options/${ref}/provenance`, { token: owner.token });
      expect(own.status).toBe(200);
      expect(own.json?.outreach).toBeDefined();
    });

    it("freemium unlock: the intruder cannot unlock (or probe) the owner's snapshot", async () => {
      if (!snapshotId) return; // no delivered snapshot on this report — nothing to probe
      const r = await api(`/snapshots/${snapshotId}/unlock`, { method: 'POST', token: intruder.token });
      expect(r.status).toBe(404); // scoped lookup — not theirs, so it "doesn't exist"
    });

    it('operator run controls are admin-only: cancel/pause → 403 for a customer', async () => {
      expect((await api(`/reports/${reportId}/cancel`, { method: 'POST', token: intruder.token, body: {} })).status).toBe(403);
      expect((await api(`/reports/${reportId}/pause`, { method: 'POST', token: intruder.token, body: {} })).status).toBe(403);
    });
  });

  describe('authorization — emails', () => {
    it('the raw email thread API is operator-only: 403 for the intruder AND for the owner', async () => {
      // Customers never read raw threads (addresses, message ids) — not even their own;
      // their view is the redacted chain inside their own report's provenance.
      expect((await api('/comms/thread/any-inquiry-id', { token: intruder.token })).status).toBe(403);
      expect((await api('/comms/thread/any-inquiry-id', { token: owner.token })).status).toBe(403);
    });

    it('the admin customer directory (emails of all users) is 403 for a customer', async () => {
      expect((await api('/admin/customers', { token: intruder.token })).status).toBe(403);
    });
  });
});
