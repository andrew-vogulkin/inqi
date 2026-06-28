import { ConfigService } from '../../infra/config/config.service';
import { GoogleTokenVerifier } from './google-token.verifier';
import { StubTokenVerifier } from './stub-token.verifier';

const cfg = (clientId?: string) => ({ google: { clientId } } as unknown as ConfigService);
const mockFetch = (ok: boolean, body: unknown) => {
  (global as any).fetch = jest.fn().mockResolvedValue({ ok, status: ok ? 200 : 401, json: async () => body });
};
afterEach(() => { delete (global as any).fetch; });

describe('GoogleTokenVerifier', () => {
  it('accepts a valid token with matching audience', async () => {
    mockFetch(true, { aud: 'client-123', sub: 'g1', email: 'A@Gmail.com', email_verified: 'true', name: 'A' });
    const id = await new GoogleTokenVerifier(cfg('client-123')).verify({ idToken: 'x' });
    expect(id).toEqual({ sub: 'g1', email: 'a@gmail.com', emailVerified: true, name: 'A' });
  });
  it('rejects a wrong-audience token', async () => {
    mockFetch(true, { aud: 'someone-else', sub: 'g1', email: 'a@b.com', email_verified: 'true' });
    await expect(new GoogleTokenVerifier(cfg('client-123')).verify({ idToken: 'x' })).rejects.toThrow(/audience/i);
  });
  it('rejects an expired/invalid token (tokeninfo non-200)', async () => {
    mockFetch(false, { error: 'invalid_token' });
    await expect(new GoogleTokenVerifier(cfg('client-123')).verify({ idToken: 'x' })).rejects.toThrow(/verification failed/i);
  });
  it('rejects a token with no email/subject', async () => {
    mockFetch(true, { aud: 'client-123', sub: 'g1' });
    await expect(new GoogleTokenVerifier(cfg('client-123')).verify({ idToken: 'x' })).rejects.toThrow(/missing/i);
  });
});

describe('StubTokenVerifier', () => {
  it('parses `stub:<email>`', async () => {
    expect(await new StubTokenVerifier().verify({ idToken: 'stub:Jo@Acme.com' }))
      .toEqual({ sub: 'stub-jo@acme.com', email: 'jo@acme.com', emailVerified: true, name: undefined });
  });
  it('parses `stub:<email>:<name>`', async () => {
    const id = await new StubTokenVerifier().verify({ idToken: 'stub:jo@acme.com:Jo Bloggs' });
    expect(id.name).toBe('Jo Bloggs');
  });
  it('rejects a non-stub token', async () => {
    await expect(new StubTokenVerifier().verify({ idToken: 'garbage' })).rejects.toThrow(/invalid stub token/i);
  });
});
