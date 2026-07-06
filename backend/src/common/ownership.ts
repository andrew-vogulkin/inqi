import { AuthRole } from '@inqi/shared';

/** The authenticated principal, for ownership checks (mirrors edge AuthUser). */
export interface OwnershipViewer { sub: string; email: string; role: string }

/** The owner-identifying fields carried on a report. */
export interface OwnedResource { customerId?: string | null; customerEmail: string }

/**
 * HP-24 — a viewer owns a resource when they're an admin, the linked customer, or
 * the (pre-auth) email-matched submitter. Non-owners get a 404 at the call site (no
 * existence leak); the capability token is just the resource id within this scope.
 */
export function ownsResource({ resource, viewer }: { resource: OwnedResource; viewer: OwnershipViewer }): boolean {
  return viewer.role === AuthRole.Admin || resource.customerId === viewer.sub || resource.customerEmail === viewer.email;
}
