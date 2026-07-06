import { EventType, FindingKind } from '@inqi/shared';
import { SnapshotsService } from './snapshots.service';

/**
 * Late-verdict snapshot refresh: a depth verdict landing after delivery re-ranks
 * + re-synthesizes the snapshot IN PLACE, so the frozen summary can never
 * contradict the live re-ranked options.
 */
function makeService({ snapshot, findings }: { snapshot: Record<string, unknown> | null; findings?: unknown[] }) {
  const tx = {};
  const prisma = { $transaction: jest.fn(async (fn: (t: unknown) => Promise<unknown>) => fn(tx)) };
  const repo = {
    findSnapshotByReport: jest.fn(async () => snapshot),
    findFindings: jest.fn(async () => findings ?? []),
    refreshContent: jest.fn(async (args: Record<string, unknown>) => ({ id: snapshot?.id, ...args })),
  };
  const outbox = { emit: jest.fn(async () => undefined) };
  const ai = { isConfigured: () => false }; // synthesis falls back to the template — deterministic
  const svc = new SnapshotsService(prisma as never, repo as never, outbox as never, ai as never, {} as never, {} as never, {} as never);
  return { svc, repo, outbox };
}

const optionFinding = (provider: string, price: number, inquiryId: string) =>
  ({ kind: FindingKind.Option, inquiryId, data: { subjectProvider: provider, price, currency: 'THB' } });
const bgFinding = (provider: string, qualityScore: number, inquiryId: string) =>
  ({ kind: FindingKind.SubjectProviderBackground, inquiryId, qualityScore, data: { subjectProvider: provider, qualityScore } });

describe('SnapshotsService.refresh (late depth verdict on a delivered report)', () => {
  it('re-ranks from current findings and updates the snapshot in place + emits snapshot.updated', async () => {
    const { svc, repo, outbox } = makeService({
      snapshot: { id: 'snap1', token: 'tok', reusedFrom: null, timeline: { generatedAt: 'earlier' } },
      findings: [
        optionFinding('Cheap But Bad', 100, 'i1'), bgFinding('Cheap But Bad', 0.1, 'i1'),
        optionFinding('Great Value', 150, 'i2'), bgFinding('Great Value', 0.9, 'i2'),
      ],
    });
    await svc.refresh({ reportId: 'r1' });

    expect(repo.refreshContent).toHaveBeenCalledTimes(1);
    const call = repo.refreshContent.mock.calls[0][0] as { id: string; options: { subjectProvider: string }[]; summary: string; timeline: Record<string, unknown> };
    expect(call.id).toBe('snap1');
    expect(call.options[0].subjectProvider).toBe('Great Value'); // quality outranks the cheap-but-bad option
    expect(call.summary).toContain('2 qualified options');
    expect(call.timeline.refreshedAt).toBeTruthy();
    expect(call.timeline.generatedAt).toBe('earlier'); // original timeline preserved
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.SnapshotUpdated, data: expect.objectContaining({ refreshed: true }) }));
  });

  it('no snapshot yet → no-op (the synthesis gate owns the pre-delivery path)', async () => {
    const { svc, repo, outbox } = makeService({ snapshot: null });
    await expect(svc.refresh({ reportId: 'r1' })).resolves.toBeNull();
    expect(repo.refreshContent).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('reused snapshot → no-op (its content belongs to the prior report)', async () => {
    const { svc, repo } = makeService({ snapshot: { id: 'snap1', token: 'tok', reusedFrom: 'prior1', timeline: {} } });
    await expect(svc.refresh({ reportId: 'r1' })).resolves.toBeNull();
    expect(repo.refreshContent).not.toHaveBeenCalled();
  });
});
