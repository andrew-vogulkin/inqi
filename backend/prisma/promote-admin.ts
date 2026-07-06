import { PrismaClient } from '@prisma/client';
import { AuthRole } from '@inqi/shared';

/**
 * Mark a Customer as an admin (or demote back to customer). Roles are owned by the
 * DB — this is the supported way to grant the admin role by hand.
 *
 *   pnpm --filter @inqi/backend db:promote-admin <email>            # → admin
 *   pnpm --filter @inqi/backend db:promote-admin <email> customer   # → customer (demote)
 */
async function main(): Promise<void> {
  const email = process.argv[2]?.trim().toLowerCase();
  const role = (process.argv[3]?.trim().toLowerCase() as AuthRole) || AuthRole.Admin;
  if (!email) {
    console.error('usage: db:promote-admin <email> [admin|customer]');
    process.exit(1);
  }
  if (role !== AuthRole.Admin && role !== AuthRole.Customer) {
    console.error(`invalid role "${role}" — expected "admin" or "customer"`);
    process.exit(1);
  }

  const db = new PrismaClient();
  try {
    const customer = await db.customer.update({ where: { email }, data: { role }, select: { id: true, email: true, role: true } });
    console.log(`✓ ${customer.email} is now "${customer.role}" (${customer.id})`);
  } catch {
    console.error(`✗ no customer found with email "${email}" — they must sign in once first`);
    process.exit(1);
  } finally {
    await db.$disconnect();
  }
}

void main();
