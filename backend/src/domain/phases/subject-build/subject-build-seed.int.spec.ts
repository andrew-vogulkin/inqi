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

it('seeds the layered network (v2) ACTIVE and the linear v1 archived for rollback/diff', async () => {
  const active = await db.prisma.workflowDefinition.findFirst({ where: { key: 'subject_build', status: 'active' }, include: { states: true, transitions: true } });
  expect(active).toBeTruthy();
  expect(active!.version).toBe(2);

  // the v2 network: 7 operators in 4 layers (layer rides in config), M:M edges
  const names = active!.states.map((s) => s.name).sort();
  expect(names).toEqual(['SUBJECT_IN', 'SUBJECT_OUT', 'attribute-mine', 'disambiguate', 'domain-learn', 'domain-recall', 'enrich-web-grounded', 'self-critique', 'target-industry-set']);
  expect(active!.states.find((s) => s.name === 'domain-recall')!.config).toMatchObject({ layer: 1 });
  expect(active!.transitions).toHaveLength(13);
  // fan-out survived the (definitionId, fromState, event, toState) unique: one READY drives three edges
  expect(active!.transitions.filter((t) => t.fromState === 'SUBJECT_IN' && t.event === 'READY')).toHaveLength(3);

  const v1 = await db.prisma.workflowDefinition.findFirst({ where: { key: 'subject_build', version: 1 }, include: { states: true } });
  expect(v1!.status).toBe('archived');
  expect(v1!.states.map((s) => s.name).sort()).toEqual(['SUBJECT_IN', 'SUBJECT_OUT', 'enrich-basic']);

  // the four engine phases still seed too (subject_build didn't disturb them)
  const keys = await db.prisma.workflowDefinition.findMany({ where: { status: 'active' }, select: { key: true }, distinct: ['key'] });
  expect(keys.map((k) => k.key).sort()).toEqual(['breadth_search', 'depth_search', 'pre_research', 'report', 'subject_build']);
});
