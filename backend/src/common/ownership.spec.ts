import { ownsResource } from './ownership';

describe('ownsResource (HP-24)', () => {
  const resource = { customerId: 'cust_1', customerEmail: 'nina@example.com' };

  it('admins own everything', () => {
    expect(ownsResource({ resource, viewer: { sub: 'op', email: 'ops@x', role: 'admin' } })).toBe(true);
  });
  it('the linked customer (by id) owns it', () => {
    expect(ownsResource({ resource, viewer: { sub: 'cust_1', email: 'whoever@x', role: 'customer' } })).toBe(true);
  });
  it('the email-matched (pre-auth) submitter owns it', () => {
    expect(ownsResource({ resource, viewer: { sub: 'other', email: 'nina@example.com', role: 'customer' } })).toBe(true);
  });
  it('a different customer does NOT own it (→ caller returns 404, no leak)', () => {
    expect(ownsResource({ resource, viewer: { sub: 'cust_2', email: 'mallory@x', role: 'customer' } })).toBe(false);
  });
  it('an unlinked resource is matched by email only', () => {
    expect(ownsResource({ resource: { customerId: null, customerEmail: 'nina@example.com' }, viewer: { sub: 'x', email: 'nina@example.com', role: 'customer' } })).toBe(true);
    expect(ownsResource({ resource: { customerId: null, customerEmail: 'nina@example.com' }, viewer: { sub: 'x', email: 'mallory@x', role: 'customer' } })).toBe(false);
  });
});
