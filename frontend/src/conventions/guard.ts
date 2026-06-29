import { AuthRole } from '@inqi/shared';
import { AccessScreen } from './enums';
import { RouteMeta } from './routes';
import { StoredSession } from './session-storage';

export interface AccessResult { allowed: boolean; screen?: AccessScreen }

/**
 * Pure auth/admin gate (FE-01 §2/§7). Signed-out on a protected route → 401
 * (SignInRequired); signed-in non-admin on an admin route → 403 (Forbidden).
 */
export function resolveAccess({ meta, session }: { meta: RouteMeta; session: StoredSession | null }): AccessResult {
  if (meta.requiresAuth && !session) return { allowed: false, screen: AccessScreen.SignInRequired };
  if (meta.adminOnly) {
    if (!session) return { allowed: false, screen: AccessScreen.SignInRequired };
    if (session.customer.role !== AuthRole.Admin) return { allowed: false, screen: AccessScreen.Forbidden };
  }
  return { allowed: true };
}
