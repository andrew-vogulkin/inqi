import { describe, it, expect } from 'vitest';
import { AuthRole } from '@inqi/shared';
import { AccessScreen } from './enums';
import { Route, ROUTE_META, matchRoute, hrefFor } from './routes';
import { resolveAccess } from './guard';
import { StoredSession } from './session-storage';

const admin: StoredSession = { token: 't', customer: { id: 'a', email: 'ops@x.io', role: AuthRole.Admin } };
const customer: StoredSession = { token: 't', customer: { id: 'c', email: 'c@x.io', role: AuthRole.Customer } };

describe('matchRoute', () => {
  it('matches static routes', () => {
    expect(matchRoute('#/styleguide')?.route).toBe(Route.StyleGuide);
    expect(matchRoute('#/admin')?.route).toBe(Route.Admin);
  });
  it('matches param routes + extracts params', () => {
    const m = matchRoute('#/r/abc123');
    expect(m?.route).toBe(Route.Report);
    expect(m?.params.token).toBe('abc123');
  });
  it('returns null for unknown paths (→ 404)', () => {
    expect(matchRoute('#/nope/nope')).toBeNull();
  });
});

describe('hrefFor', () => {
  it('fills params', () => {
    expect(hrefFor({ route: Route.AdminInquiry, params: { id: 'i9' } })).toBe('#/admin/i/i9');
  });
});

describe('resolveAccess', () => {
  it('blocks signed-out from protected routes (401)', () => {
    expect(resolveAccess({ meta: ROUTE_META[Route.Dashboard], session: null })).toEqual({ allowed: false, screen: AccessScreen.SignInRequired });
  });
  it('blocks a non-admin from admin routes (403)', () => {
    expect(resolveAccess({ meta: ROUTE_META[Route.Admin], session: customer })).toEqual({ allowed: false, screen: AccessScreen.Forbidden });
  });
  it('allows an admin', () => {
    expect(resolveAccess({ meta: ROUTE_META[Route.Admin], session: admin })).toEqual({ allowed: true });
  });
  it('lets anyone view truly-public routes (sign-in / styleguide)', () => {
    expect(resolveAccess({ meta: ROUTE_META[Route.StyleGuide], session: null })).toEqual({ allowed: true });
    expect(resolveAccess({ meta: ROUTE_META[Route.SignIn], session: null })).toEqual({ allowed: true });
  });
  it('HP-24: questionnaire + report deep links now require auth (401 when signed out)', () => {
    expect(resolveAccess({ meta: ROUTE_META[Route.Questionnaire], session: null })).toEqual({ allowed: false, screen: AccessScreen.SignInRequired });
    expect(resolveAccess({ meta: ROUTE_META[Route.Report], session: null })).toEqual({ allowed: false, screen: AccessScreen.SignInRequired });
  });
});
