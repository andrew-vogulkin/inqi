import { APIRequestContext, expect } from '@playwright/test';

/**
 * Helpers for the live-backend security suite (cross-access, prompt injection,
 * compliance). Unlike the FE-draw e2e (which mocks the API), these exercise the
 * REAL dev backend so the assertions actually prove a guardrail — an ownership
 * boundary, a compliance denial, an inert-ingest of adversarial text — rather
 * than a mock we wrote. They are gated behind E2E_LIVE=1 (see each spec) and
 * hit E2E_API_BASE (default: the shared dev deployment).
 */
export const API = (process.env.E2E_API_BASE ?? 'https://inqi.monkeycode.io/api').replace(/\/$/, '');

/** Mock MFA transport: every code verifies against 123456 in dev (MFA_MOCK_CODE). */
const MFA_CODE = process.env.E2E_MFA_CODE ?? '123456';

export interface Session { token: string; customer: { id: string; email: string; role: string } }

/** Two-step email sign-in → session. Dev auto-provisions the customer on first sign-in. */
export async function signIn(request: APIRequestContext, email: string): Promise<Session> {
  await request.post(`${API}/auth/email`, { data: { email } });
  const res = await request.post(`${API}/auth/email/verify`, { data: { email, code: MFA_CODE } });
  expect(res.ok(), `sign-in for ${email} (${res.status()})`).toBeTruthy();
  const body = (await res.json()) as Session;
  expect(body.token, 'a session token').toBeTruthy();
  return body;
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Submit a report as the signed-in customer. Returns the raw response so a test can assert the status. */
export function submitReport(request: APIRequestContext, token: string, rawRequest: string) {
  return request.post(`${API}/reports`, { headers: auth(token), data: { rawRequest } });
}

/** Submit and assert it was accepted; returns the created report id. */
export async function createReport(request: APIRequestContext, token: string, rawRequest: string): Promise<string> {
  const res = await submitReport(request, token, rawRequest);
  expect(res.ok(), `submit accepted (${res.status()})`).toBeTruthy();
  const body = (await res.json()) as { id: string };
  expect(body.id, 'a report id').toBeTruthy();
  return body.id;
}

export interface LiveReport {
  reportId: string; state: string; stage: string; rawRequest: string;
  summary: string; options: Array<{ name?: string; contactEmail?: string | null }>;
  delivered: boolean;
}

export async function getLive(request: APIRequestContext, token: string, id: string): Promise<LiveReport> {
  const res = await request.get(`${API}/reports/${id}/live`, { headers: auth(token) });
  expect(res.ok(), `live read (${res.status()})`).toBeTruthy();
  return (await res.json()) as LiveReport;
}

export async function listReports(request: APIRequestContext, token: string): Promise<Array<{ id: string }>> {
  const res = await request.get(`${API}/reports`, { headers: auth(token) });
  expect(res.ok(), `list (${res.status()})`).toBeTruthy();
  return (await res.json()) as Array<{ id: string }>;
}

/**
 * Poll the live state until `match` holds (e.g. it reaches DENIED) or timeout.
 * Compliance runs early in pre-research but is a queued, model-backed step, so
 * give it room. Returns the final live snapshot.
 */
export async function waitForState(
  request: APIRequestContext, token: string, id: string,
  match: (state: string) => boolean, timeoutMs = 240_000,
): Promise<LiveReport> {
  let last: LiveReport | undefined;
  await expect
    .poll(async () => { last = await getLive(request, token, id); return match(last.state); },
      { timeout: timeoutMs, intervals: [2_000, 3_000, 5_000] })
    .toBe(true);
  return last!;
}
