import { AuthRole } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { SessionService } from './session.service';

const svc = (ttlHours = 24) =>
  new SessionService({ session: { secret: 'test-secret', ttlHours } } as unknown as ConfigService);
const claims = { sub: 'c1', email: 'a@b.com', role: AuthRole.Customer };
const payloadOf = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { iat: number; exp: number };

describe('SessionService', () => {
  it('round-trips claims through sign/verify', () => {
    const s = svc();
    expect(s.verify(s.sign(claims))).toEqual(claims);
  });

  it('rejects a tampered payload (bad signature)', () => {
    const s = svc();
    const [h, , sig] = s.sign(claims).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, role: AuthRole.Admin, iat: 0, exp: 9e9 })).toString('base64url');
    expect(() => s.verify(`${h}.${forged}.${sig}`)).toThrow(/signature/i);
  });

  it('rejects an expired token', () => {
    const s = svc(-1); // exp in the past
    expect(() => s.verify(s.sign(claims))).toThrow(/expired/i);
  });

  it('rejects a malformed token', () => {
    expect(() => svc().verify('not-a-jwt')).toThrow(/malformed/i);
  });

  it('a token signed with another secret does not verify', () => {
    const token = svc().sign(claims);
    const other = new SessionService({ session: { secret: 'different', ttlHours: 24 } } as unknown as ConfigService);
    expect(() => other.verify(token)).toThrow(/signature/i);
  });

  it('stamps an 8-hour expiry from the issue time', () => {
    const p = payloadOf(svc(8).sign(claims));
    expect(p.exp - p.iat).toBe(8 * 3600);
  });

  it('prolongs the session — a token re-signed later carries a later, full-TTL expiry', () => {
    const s = svc(8);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000_000_000);
    const first = payloadOf(s.sign(claims));
    spy.mockReturnValue(1_000_000_000_000 + 5 * 60_000); // 5 minutes later
    const second = payloadOf(s.sign(claims));
    spy.mockRestore();
    expect(second.iat).toBeGreaterThan(first.iat);
    expect(second.exp).toBeGreaterThan(first.exp);        // prolonged
    expect(second.exp - second.iat).toBe(8 * 3600);       // still a full 8h window
  });
});
