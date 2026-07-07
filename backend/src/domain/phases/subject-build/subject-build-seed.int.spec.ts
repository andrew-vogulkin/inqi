import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { startTestDb, TestDb } from '../../../test-support/db-harness';

/**
 * INTEGRATION — the seed installs subject_build v1 against a real Postgres (with the
 * new WorkflowState.handler/config columns). Offline: the seed makes no model calls.
 * Run: `pnpm test:int`.
 */
let db: TestDb;

beforeAll(async () => {
  db = await startTestDb(); // prisma db push (incl. handler/config) + init.sql
  const backendDir = join(__dirname, '..', '..', '..', '..'); // subject-build → backend
  execFileSync(join(backendDir, 'node_modules', '.bin', 'tsx'), ['prisma/seed.ts'], {
    cwd: backendDir, env: { ...process.env, DATABASE_URL: db.url }, stdio: 'inherit',
  });
}, 240_000);

afterAll(async () => { await db?.stop(); });

it('seeds subject_build v1 as an active versioned workflow (IN → enrich-basic → OUT)', async () => {
  const def = await db.prisma.workflowDefinition.findFirst({ where: { key: 'subject_build', status: 'active' }, include: { states: true, transitions: true } });
  expect(def).toBeTruthy();
  expect(def!.version).toBe(1);

  const names = def!.states.map((s) => s.name).sort();
  expect(names).toEqual(['SUBJECT_IN', 'SUBJECT_OUT', 'enrich-basic']);
  expect(def!.states.find((s) => s.name === 'SUBJECT_IN')!.isInitial).toBe(true);
  expect(def!.states.find((s) => s.name === 'SUBJECT_OUT')!.isTerminal).toBe(true);
  expect(def!.transitions).toHaveLength(2);

  // the four engine phases still seed too (subject_build didn't disturb them)
  const keys = await db.prisma.workflowDefinition.findMany({ where: { status: 'active' }, select: { key: true }, distinct: ['key'] });
  expect(keys.map((k) => k.key).sort()).toEqual(['breadth_search', 'depth_search', 'pre_research', 'report', 'subject_build']);
});
