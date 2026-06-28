import { AuthRole } from '@inqi/shared';
import { resolveRole } from './role';

describe('resolveRole', () => {
  const cfg = { adminEmails: ['boss@acme.com'], adminDomain: 'monkeycode.io' };
  it('admin via explicit email (case-insensitive)', () => {
    expect(resolveRole({ email: 'Boss@Acme.com', ...cfg })).toBe(AuthRole.Admin);
  });
  it('admin via domain', () => {
    expect(resolveRole({ email: 'andrei@monkeycode.io', ...cfg })).toBe(AuthRole.Admin);
  });
  it('customer when neither matches', () => {
    expect(resolveRole({ email: 'jo@gmail.com', ...cfg })).toBe(AuthRole.Customer);
  });
  it('customer when allowlist is empty', () => {
    expect(resolveRole({ email: 'x@y.com', adminEmails: [] })).toBe(AuthRole.Customer);
  });
});
