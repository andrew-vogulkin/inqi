import { PrismaClient } from '@prisma/client';
import { SubjectsRepository } from './subjects.repository';
import { PrismaService } from '../../infra/persistence/prisma.service';
import { startTestDb, TestDb } from '../../test-support/db-harness';

/**
 * INTEGRATION — SubjectsRepository against a real Postgres (pgvector + PostGIS).
 *
 * These exercise the raw SQL the unit suite can't: `storeVector` (pgvector/PostGIS
 * writes) and `findReusableCandidates` (the `<=>` cosine + `ST_Distance` query).
 * The first case is a direct regression test for the join bug — the query joined
 * "Report" instead of "ReportSnapshot", threw `column r.reportId does not exist`
 * on every call, and the caller's fail-open catch hid it. Run: `pnpm test:int`.
 */

/** The embedding column is vector(1024); build a mostly-zero unit vector with a spike. */
function vec(spikeIndex: number, secondary?: { index: number; weight: number }): number[] {
  const v = new Array(1024).fill(0);
  v[spikeIndex] = 1;
  if (secondary) v[secondary.index] = secondary.weight;
  return v;
}

let db: TestDb;
let prisma: PrismaClient;
let repo: SubjectsRepository;
let workflowVersionId: string;

beforeAll(async () => {
  db = await startTestDb();
  prisma = db.prisma;
  repo = new SubjectsRepository(prisma as unknown as PrismaService);
  const wf = await prisma.workflowDefinition.create({ data: { key: 'report', version: 1, status: 'active' } });
  workflowVersionId = wf.id;
}, 180_000);

afterAll(async () => { await db?.stop(); });

/** Clear the report graph between tests so each starts from a known set of neighbours. */
beforeEach(async () => {
  await prisma.reportSnapshot.deleteMany();
  await prisma.subject.deleteMany();
  await prisma.report.deleteMany();
});

/** A prior, delivered report with a subject (embedding + optional geo) and a snapshot (the reuse target). */
async function seedPriorReport(opts: {
  id: string; token: string; embedding: number[];
  lat?: number | null; lng?: number | null; ageDays?: number; withEmbedding?: boolean;
}): Promise<void> {
  const createdAt = new Date(Date.now() - (opts.ageDays ?? 0) * 86_400_000);
  await prisma.report.create({
    data: { id: opts.id, customerEmail: `${opts.id}@x.io`, rawRequest: `req ${opts.id}`, workflowVersionId, state: 'REPORT_DELIVERED', createdAt },
  });
  await prisma.subject.create({ data: { reportId: opts.id, title: `subj ${opts.id}`, description: 'desc', category: 'item' } });
  if (opts.withEmbedding !== false) {
    await repo.storeVector({ reportId: opts.id, embedding: opts.embedding, lat: opts.lat ?? null, lng: opts.lng ?? null });
  }
  await prisma.reportSnapshot.create({
    data: { reportId: opts.id, token: opts.token, summary: 'prior summary', options: [], timeline: [], createdAt },
  });
}

const LISBON = { lat: 38.7223, lng: -9.1393 };

describe('SubjectsRepository.findReusableCandidates (real DB)', () => {
  it('returns the semantic neighbour joined to its snapshot, with real metrics (regression: the join bug)', async () => {
    await seedPriorReport({ id: 'prior1', token: 'tok-prior1', embedding: vec(0), lat: LISBON.lat, lng: LISBON.lng, ageDays: 10 });

    const rows = await repo.findReusableCandidates({
      reportId: 'current', embedding: vec(0, { index: 1, weight: 0.01 }), // nearly identical direction
      lat: LISBON.lat, lng: LISBON.lng + 0.001, limit: 5,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].snapshotId).toBeTruthy();          // r.id resolved (was undefined under the broken join)
    expect(rows[0].token).toBe('tok-prior1');         // r.token — a ReportSnapshot column, not Report
    expect(rows[0].distance).toBeLessThan(0.01);      // <=> cosine, near-identical
    expect(rows[0].distanceMeters).not.toBeNull();
    expect(rows[0].distanceMeters!).toBeLessThan(1_000); // ~150m apart
    expect(rows[0].ageDays).toBeGreaterThan(9.9);
    expect(rows[0].ageDays).toBeLessThan(10.1);
  });

  it('excludes the querying report itself (WHERE reportId <> $2)', async () => {
    await seedPriorReport({ id: 'self', token: 'tok-self', embedding: vec(0), lat: LISBON.lat, lng: LISBON.lng });
    const rows = await repo.findReusableCandidates({ reportId: 'self', embedding: vec(0), lat: LISBON.lat, lng: LISBON.lng, limit: 5 });
    expect(rows).toHaveLength(0);
  });

  it('orders by cosine distance — the nearest subject ranks first', async () => {
    await seedPriorReport({ id: 'near', token: 'tok-near', embedding: vec(0), lat: LISBON.lat, lng: LISBON.lng });
    await seedPriorReport({ id: 'far', token: 'tok-far', embedding: vec(500), lat: LISBON.lat, lng: LISBON.lng }); // orthogonal → distance 1

    const rows = await repo.findReusableCandidates({ reportId: 'current', embedding: vec(0), lat: LISBON.lat, lng: LISBON.lng, limit: 5 });
    expect(rows.map((r) => r.token)).toEqual(['tok-near', 'tok-far']);
    expect(rows[0].distance).toBeLessThan(rows[1].distance);
  });

  it('returns distanceMeters null when geo is absent (no PostGIS crash)', async () => {
    await seedPriorReport({ id: 'nogeo', token: 'tok-nogeo', embedding: vec(0), lat: null, lng: null });
    const rows = await repo.findReusableCandidates({ reportId: 'current', embedding: vec(0), lat: null, lng: null, limit: 5 });
    expect(rows).toHaveLength(1);
    expect(rows[0].distanceMeters).toBeNull();
  });

  it('skips subjects with no embedding (WHERE embedding IS NOT NULL) — storeVector gates inclusion', async () => {
    await seedPriorReport({ id: 'unembedded', token: 'tok-unembedded', embedding: vec(0), withEmbedding: false });
    const rows = await repo.findReusableCandidates({ reportId: 'current', embedding: vec(0), lat: null, lng: null, limit: 5 });
    expect(rows).toHaveLength(0); // present in the DB, but never storeVector'd → excluded
  });
});
