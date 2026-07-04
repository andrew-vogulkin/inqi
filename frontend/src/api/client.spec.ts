import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Mock } from 'vitest';
import { ApiError, ApiErrorCode } from './errors';

// Mock the session store so Bearer injection is controllable in node env.
vi.mock('../conventions/session-storage', () => ({ getStoredSession: vi.fn(() => null) }));
import { getStoredSession } from '../conventions/session-storage';
import { request, serializeQuery, setUnauthorizedHandler, HttpMethod } from './client';

const getStored = getStoredSession as unknown as Mock;
const resp = (status: number, body?: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => (body === undefined ? '' : JSON.stringify(body)) });
let fetchMock: Mock;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  getStored.mockReturnValue(null);
  setUnauthorizedHandler(null);
});
afterEach(() => vi.unstubAllGlobals());

describe('serializeQuery', () => {
  it('builds an encoded querystring and skips undefined/null', () => {
    expect(serializeQuery({ a: '1', b: undefined, c: null, d: 2 })).toBe('?a=1&d=2');
    expect(serializeQuery()).toBe('');
    expect(serializeQuery({ q: 'a b&c' })).toBe('?q=a+b%26c');
  });
});

describe('request — Bearer injection', () => {
  it('attaches the session token, and omits it when auth:false', async () => {
    getStored.mockReturnValue({ token: 'abc', customer: { id: 'c', email: 'e', role: 'customer' } });
    fetchMock.mockResolvedValue(resp(200, { ok: true }));

    await request({ method: HttpMethod.Get, path: '/me/credits' });
    expect((fetchMock.mock.calls[0][1] as RequestInit).headers).toMatchObject({ authorization: 'Bearer abc' });

    await request({ method: HttpMethod.Get, path: '/q/tok', auth: false });
    expect((fetchMock.mock.calls[1][1] as RequestInit).headers).not.toHaveProperty('authorization');
  });

  it('serializes the query into the URL', async () => {
    fetchMock.mockResolvedValue(resp(200, {}));
    await request({ method: HttpMethod.Get, path: '/audit', query: { types: 'denial', reportId: undefined } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/audit?types=denial');
  });
});

describe('request — envelope → ApiError', () => {
  it('parses the typed envelope (code/message/retryable/httpStatus)', async () => {
    fetchMock.mockResolvedValue(resp(402, { error: { code: 'CREDITS_INSUFFICIENT', message: 'no credits', retryable: false } }));
    await expect(request({ method: HttpMethod.Post, path: '/reports' })).rejects.toMatchObject({
      code: ApiErrorCode.CreditsInsufficient, httpStatus: 402, retryable: false,
    });
  });

  it('falls back to a status-derived code when there is no envelope', async () => {
    fetchMock.mockResolvedValue(resp(403, undefined));
    await expect(request({ method: HttpMethod.Get, path: '/reports/i1/cost' })).rejects.toMatchObject({ code: ApiErrorCode.AuthForbidden, httpStatus: 403 });
  });
});

describe('request — global 401', () => {
  it('invokes the unauthorized handler and throws', async () => {
    const handler = vi.fn();
    setUnauthorizedHandler(handler);
    fetchMock.mockResolvedValue(resp(401, { error: { code: 'AUTH_REQUIRED' } }));
    await expect(request({ method: HttpMethod.Get, path: '/reports' })).rejects.toBeInstanceOf(ApiError);
    expect(handler).toHaveBeenCalledOnce();
  });
});

describe('request — retry only when retryable', () => {
  it('retries a retryable error then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(resp(503, { error: { code: 'AI_REQUEST_FAILED', retryable: true } }))
      .mockResolvedValueOnce(resp(200, { ok: true }));
    const out = await request<{ ok: boolean }>({ method: HttpMethod.Get, path: '/x', retry: { baseDelayMs: 0 } });
    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a non-retryable error (no blind mutation retry)', async () => {
    fetchMock.mockResolvedValue(resp(400, { error: { code: 'VALIDATION_FAILED', retryable: false } }));
    await expect(request({ method: HttpMethod.Post, path: '/reports', retry: { baseDelayMs: 0 } })).rejects.toMatchObject({ code: ApiErrorCode.ValidationFailed });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries a GET network failure (idempotent) but gives up after maxRetries', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await expect(request({ method: HttpMethod.Get, path: '/x', retry: { maxRetries: 2, baseDelayMs: 0 } })).rejects.toMatchObject({ code: ApiErrorCode.Network });
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does NOT retry a POST network failure', async () => {
    fetchMock.mockRejectedValue(new TypeError('network down'));
    await expect(request({ method: HttpMethod.Post, path: '/reports', retry: { baseDelayMs: 0 } })).rejects.toMatchObject({ code: ApiErrorCode.Network });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
