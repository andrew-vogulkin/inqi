import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { PrismaClient } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Integration-test database harness: a throwaway Postgres in a container, built
 * exactly like prod — the pgvector + PostGIS image, the Prisma schema, then
 * `prisma/sql/init.sql` (extensions + the raw `Subject.embedding`/`geo` columns).
 *
 * This exists because the unit suite mocks the repository layer, so raw-SQL bugs
 * (wrong table in a JOIN, a bad cast, a `<=>`/PostGIS typo) are invisible to it —
 * exactly how the `findReusableCandidates` join broke silently. These tests run
 * the real queries against a real database.
 *
 * Needs a local Docker daemon. The image (default `inqi-db:latest`) must carry
 * pgvector + PostGIS; override with INQI_TEST_DB_IMAGE.
 */
const IMAGE = process.env.INQI_TEST_DB_IMAGE ?? 'inqi-db:latest';

export interface TestDb {
  prisma: PrismaClient;
  url: string;
  stop: () => Promise<void>;
}

export async function startTestDb(): Promise<TestDb> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer(IMAGE)
    .withDatabase('inqi')
    .withUsername('inqi')
    .withPassword('inqi')
    .start();

  const url = container.getConnectionUri();
  const backendDir = join(__dirname, '..', '..'); // src/test-support -> backend

  // 1) Prisma schema → tables (host connects to the mapped port via DATABASE_URL).
  const prismaBin = join(backendDir, 'node_modules', '.bin', 'prisma');
  execFileSync(prismaBin, ['db', 'push', '--skip-generate', '--accept-data-loss'], {
    cwd: backendDir,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });

  // 2) init.sql (extensions + embedding/geo columns + NOTIFY trigger). It contains a
  //    plpgsql function with $$-quoting + multiple statements, so run it through psql
  //    inside the container (simple query protocol) rather than a Prisma raw call.
  const initSql = readFileSync(join(backendDir, 'prisma', 'sql', 'init.sql'), 'utf8');
  const res = await container.exec(['psql', '-v', 'ON_ERROR_STOP=1', '-U', 'inqi', '-d', 'inqi', '-c', initSql]);
  if (res.exitCode !== 0) throw new Error(`init.sql failed (exit ${res.exitCode}):\n${res.output}`);

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  await prisma.$connect();
  return {
    prisma,
    url,
    stop: async () => { await prisma.$disconnect(); await container.stop(); },
  };
}
