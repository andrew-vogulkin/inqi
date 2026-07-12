import { BreadthPurpose, QueueJob, WorkflowEvent } from '@inqi/shared';
import { AssembleFunnelService } from './assemble-funnel.service';

const CANDIDATES = [
  { name: 'Alpha', country: 'TH', source: 'ai', evidence: [{ url: 'https://a.example', title: 'Alpha', snippet: 's' }] },
  { name: 'Beta', country: 'TH', source: 'ai' },
  { name: 'Gamma', country: 'TH', source: 'ai' },
];

function build({ purpose, candidates = CANDIDATES, existing = [], breadthCap = 8 }: {
  purpose: BreadthPurpose; candidates?: unknown[]; existing?: { name: string; wave: number }[]; breadthCap?: number;
}) {
  const run = { id: 'run1', reportId: 'r1', inquiryId: null, data: { purpose, epicId: 'e1', candidates, count: 8, notes: [] } };
  const boss = { work: jest.fn(), enqueue: jest.fn() };
  const outbox = { emit: jest.fn() };
  const config = { research: { maxBreadthInquiries: breadthCap } };
  let seq = 0;
  const repo = {
    createInquiry: jest.fn().mockImplementation(async () => ({ id: `inq${++seq}` })),
    findEpicWithInquiries: jest.fn().mockResolvedValue({ id: 'e1', priority: 5, inquiries: existing }),
    createFinding: jest.fn(),
  };
  const phaseRuns = { findById: jest.fn().mockResolvedValue(run) };
  const sources = { addWebsearch: jest.fn() };
  const outreach = { releaseWave: jest.fn(), finishOutreach: jest.fn() };
  const wf = { advance: jest.fn() };
  const tunables = { forReport: jest.fn().mockResolvedValue({}) }; // no genes set → env/constant fallbacks
  const svc = new AssembleFunnelService(
    boss as never, outbox as never, config as never, repo as never,
    phaseRuns as never, sources as never, outreach as never, wf as never, tunables as never,
  );
  return { svc, boss, outbox, repo, sources, outreach, wf, tunables };
}

describe('AssembleFunnelService — breadth run → funnel inquiries', () => {
  it('funnel purpose: creates waved inquiries + evidence + depth runs, fires FUNNEL_BUILT', async () => {
    const { svc, repo, boss, sources, wf } = build({ purpose: BreadthPurpose.Funnel });
    await svc.assemble({ runId: 'run1' });
    expect(repo.createInquiry).toHaveBeenCalledTimes(3);
    expect(repo.createInquiry).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Alpha', wave: 1, epicId: 'e1' }) });
    expect(sources.addWebsearch).toHaveBeenCalledTimes(1); // only Alpha carries evidence
    expect(boss.enqueue).toHaveBeenCalledWith(expect.objectContaining({ job: QueueJob.ResearchBackground }));
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.FUNNEL_BUILT });
  });

  it('widen purpose: fresh candidates become the next wave and it releases immediately', async () => {
    const { svc, repo, outreach } = build({
      purpose: BreadthPurpose.Widen,
      existing: [{ name: 'Alpha', wave: 1 }, { name: 'Old', wave: 2 }],
    });
    await svc.assemble({ runId: 'run1' });
    // Alpha already exists → only Beta + Gamma, at wave 3.
    expect(repo.createInquiry).toHaveBeenCalledTimes(2);
    expect(repo.createInquiry).toHaveBeenCalledWith({ data: expect.objectContaining({ name: 'Beta', wave: 3 }) });
    expect(outreach.releaseWave).toHaveBeenCalledWith(expect.objectContaining({ wave: 3 }));
    expect(outreach.finishOutreach).not.toHaveBeenCalled();
  });

  it('widen with nothing fresh finishes outreach with what exists', async () => {
    const { svc, repo, outreach } = build({
      purpose: BreadthPurpose.Widen,
      existing: CANDIDATES.map((c, i) => ({ name: c.name, wave: i + 1 })),
    });
    await svc.assemble({ runId: 'run1' });
    expect(repo.createInquiry).not.toHaveBeenCalled();
    expect(outreach.finishOutreach).toHaveBeenCalledWith({ reportId: 'r1' });
  });

  it('widen respects the per-report breadth cap', async () => {
    const { svc, repo } = build({
      purpose: BreadthPurpose.Widen,
      existing: [{ name: 'X1', wave: 1 }, { name: 'X2', wave: 1 }],
      breadthCap: 3, // room for exactly 1 more
    });
    await svc.assemble({ runId: 'run1' });
    expect(repo.createInquiry).toHaveBeenCalledTimes(1);
  });

  it('funnel purpose with ZERO candidates fails the funnel — no fabricated providers', async () => {
    const { svc, repo, wf } = build({ purpose: BreadthPurpose.Funnel, candidates: [] });
    await svc.assemble({ runId: 'run1' });
    expect(repo.createInquiry).not.toHaveBeenCalled();
    expect(wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.FUNNEL_FAILED });
  });

  it('a funnel-purpose assembly failure fires FUNNEL_FAILED; a widen failure degrades to finishing', async () => {
    const funnel = build({ purpose: BreadthPurpose.Funnel });
    funnel.repo.createInquiry.mockRejectedValue(new Error('db down'));
    await funnel.svc.assemble({ runId: 'run1' });
    expect(funnel.wf.advance).toHaveBeenCalledWith({ reportId: 'r1', event: WorkflowEvent.FUNNEL_FAILED });

    const widen = build({ purpose: BreadthPurpose.Widen, existing: [{ name: 'Old', wave: 1 }] });
    widen.repo.createInquiry.mockRejectedValue(new Error('db down'));
    await widen.svc.assemble({ runId: 'run1' });
    expect(widen.outreach.finishOutreach).toHaveBeenCalled();
  });
});
