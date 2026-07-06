import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { AuthRole } from '@inqi/shared';

for (const p of [resolve(__dirname, '../../.env'), resolve(process.cwd(), '../.env'), resolve(process.cwd(), '.env')]) {
  try { process.loadEnvFile(p); break; } catch { /* next */ }
}
const db = new PrismaClient();
const EMAIL = 'andrei@codemonkey.io';

async function main() {
  const c = await db.customer.upsert({
    where: { email: EMAIL },
    update: { name: 'Andrei', role: AuthRole.Customer },
    create: { email: EMAIL, name: 'Andrei', role: AuthRole.Customer, credits: 5, freeReportUsed: false },
  });
  console.log(`Seeded ${EMAIL} (id ${c.id}, role ${c.role}, credits ${c.credits}, freeReportUsed ${c.freeReportUsed})`);
}
main().catch((e) => { console.error(e); process.exit(1); }).finally(() => db.$disconnect());
