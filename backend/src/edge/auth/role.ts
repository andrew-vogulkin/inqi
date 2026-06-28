import { AuthRole } from '@inqi/shared';

/**
 * Pure admin-allowlist rule (HP-10): a verified email is an admin when it's in the
 * explicit `ADMIN_EMAILS` list or under the `ADMIN_DOMAIN`; everyone else is a
 * customer. Case-insensitive. No magic strings — returns an {@link AuthRole}.
 */
export function resolveRole({ email, adminEmails, adminDomain }: { email: string; adminEmails: string[]; adminDomain?: string }): AuthRole {
  const e = email.trim().toLowerCase();
  if (adminEmails.map((a) => a.toLowerCase()).includes(e)) return AuthRole.Admin;
  if (adminDomain && e.endsWith(`@${adminDomain.toLowerCase()}`)) return AuthRole.Admin;
  return AuthRole.Customer;
}
