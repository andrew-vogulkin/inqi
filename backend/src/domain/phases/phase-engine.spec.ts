import { EventType, PhaseControlEvent, PhaseKey, QueueJob } from '@inqi/shared';
import { ConflictError } from '../../common/errors';
import { PhaseEngine } from './phase-engine.service';
import { PhaseStepRegistry } from './phase-step.tokens';

const RUN = {
  id: 'run1', key: PhaseKey.BreadthSearch, workflowVersionId: 'def1', state: 'SEARCH',
  reportId: 'r1', inquiryId: null, data: { cycle: 1, maxCycles: 3 }, attempts: 0,
};

function build({ transition, run = RUN, states, guardOk = true }: {
  transition?: { toState: string; guard?: string | null; action?: string | null } | null;
  run?: typeof RUN | null;
  states?: { name: string; isInitial?: boolean; isTerminal?: boolean }[];
  guardOk?: boolean;
} = {}) {
  const stateRows = states ?? [
    { name: 'FORM_QUERIES', isInitial: true }, { name: 'SEARCH' }, { name: 'MINE' },
    { name: 'TARGET_MET', isTerminal: true }, { name: 'FAILED', isTerminal: true }, { name: 'CANCELLED', isTerminal: true },
  ];
  const db = {
    workflowDefinition: { findFirst: jest.fn().mockResolvedValue({ id: 'def1' }) },
    workflowState: {
      findFirst: jest.fn().mockResolvedValue(stateRows.find((s) => s.isInitial)),
      findMany: jest.fn().mockResolvedValue(stateRows.map((s) => ({ name: s.name, isTerminal: !!s.isTerminal }))),
    },
    workflowTransition: {
      findFirst: jest.fn().mockResolvedValue(transition === undefined ? { toState: 'MINE', guard: null, action: 'phase:enqueue-step' } : transition),
    },
    agentEvent: { create: jest.fn() },
  };
  const repo = {
    create: jest.fn().mockResolvedValue({ ...RUN, state: 'FORM_QUERIES' }),
    findById: jest.fn().mockResolvedValue(run),
    findWithContext: jest.fn().mockResolvedValue(run ? { ...run, report: { id: 'r1', cancelRequested: false, state: 'FUNNEL' }, inquiry: null } : null),
    findActive: jest.fn().mockResolvedValue(null),
    advanceOptimistic: jest.fn().mockResolvedValue(true),
    bumpAttempts: jest.fn().mockImplementation(async () => ({ ...RUN, attempts: (run?.attempts ?? 0) + 1 })),
    createShadowRun: jest.fn(),
    findShadowRun: jest.fn().mockResolvedValue({ id: 'ar1' }),
    heartbeatShadowRun: jest.fn(),
    closeShadowRun: jest.fn(),
  };
  const boss = { enqueue: jest.fn() };
  const outbox = { emit: jest.fn() };
  const config = { resilience: { maxAttempts: 3, leaseMs: 60_000 } };
  const usageCtx = { run: jest.fn((_ctx: unknown, fn: () => Promise<unknown>) => fn()) };
  const registry = { runGuard: jest.fn().mockReturnValue(guardOk), runAction: jest.fn() };
  const steps = new PhaseStepRegistry();
  const engine = new PhaseEngine(
    db as never, repo as never, boss as never, outbox as never, config as never,
    usageCtx as never, registry as never, steps,
  );
  return { engine, db, repo, boss, outbox, registry, steps };
}

describe('PhaseEngine.startRun', () => {
  it('pins the active version, enters the initial state, opens the shadow run, enqueues the first step', async () => {
    const { engine, repo, boss, outbox } = build();
    const run = await engine.startRun({ key: PhaseKey.BreadthSearch, reportId: 'r1', data: { cycle: 1 } });
    expect(run).not.toBeNull();
    expect(repo.create).toHaveBeenCalledWith({ data: expect.objectContaining({ key: PhaseKey.BreadthSearch, workflowVersionId: 'def1', state: 'FORM_QUERIES' }) });
    expect(repo.createShadowRun).toHaveBeenCalledWith(expect.objectContaining({ stage: PhaseKey.BreadthSearch, phaseRunId: 'run1' }));
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.PhaseRunStarted }));
    expect(boss.enqueue).toHaveBeenCalledWith({ job: QueueJob.PhaseStep, data: { runId: 'run1', expectedState: 'FORM_QUERIES' } });
  });

  it('dedupes: a live run for the same scope means no new run starts', async () => {
    const { engine, repo, boss } = build();
    repo.findActive.mockResolvedValue({ id: 'existing' });
    const run = await engine.startRun({ key: PhaseKey.BreadthSearch, reportId: 'r1', data: {} });
    expect(run).toBeNull();
    expect(repo.create).not.toHaveBeenCalled();
    expect(boss.enqueue).not.toHaveBeenCalled();
  });
});

describe('PhaseEngine.advanceRun', () => {
  it('happy path: guard + optimistic commit + transitioned event + action', async () => {
    const { engine, repo, outbox, registry } = build();
    const to = await engine.advanceRun({ runId: 'run1', event: 'POOL_READY', dataPatch: { pool: [1] } });
    expect(to).toBe('MINE');
    expect(repo.advanceOptimistic).toHaveBeenCalledWith(expect.objectContaining({ fromState: 'SEARCH', toState: 'MINE', data: expect.objectContaining({ pool: [1], cycle: 1 }) }));
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.PhaseRunTransitioned }));
    expect(registry.runAction).toHaveBeenCalledWith(expect.objectContaining({ name: 'phase:enqueue-step' }));
  });

  it('terminal advance closes the shadow run and emits phase.run.finished', async () => {
    const { engine, repo, outbox } = build({ transition: { toState: 'TARGET_MET', action: null } });
    await engine.advanceRun({ runId: 'run1', event: 'TARGET_MET' });
    expect(repo.closeShadowRun).toHaveBeenCalledWith(expect.objectContaining({ phaseRunId: 'run1' }));
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.PhaseRunFinished }));
  });

  it('no matching transition → ConflictError', async () => {
    const { engine } = build({ transition: null });
    await expect(engine.advanceRun({ runId: 'run1', event: 'NOPE' })).rejects.toThrow(ConflictError);
  });

  it('lost optimistic race → ConflictError, action never runs', async () => {
    const { engine, repo, registry } = build();
    repo.advanceOptimistic.mockResolvedValue(false);
    await expect(engine.advanceRun({ runId: 'run1', event: 'POOL_READY' })).rejects.toThrow(ConflictError);
    expect(registry.runAction).not.toHaveBeenCalled();
  });

  it('blocked guard → ConflictError (a blocked guard is a handler bug, not a retry)', async () => {
    const { engine, repo } = build({ transition: { toState: 'MINE', guard: 'breadth:under-cycle-cap', action: null }, guardOk: false });
    await expect(engine.advanceRun({ runId: 'run1', event: 'POOL_READY' })).rejects.toThrow(ConflictError);
    expect(repo.advanceOptimistic).not.toHaveBeenCalled();
  });
});

describe('PhaseEngine.executeStep — the phase_step worker', () => {
  it('skips a stale delivery whose expectedState no longer matches', async () => {
    const { engine, steps, registry } = build();
    const handler = { execute: jest.fn() };
    steps.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler });
    await engine.executeStep({ runId: 'run1', expectedState: 'MINE' });
    expect(handler.execute).not.toHaveBeenCalled();
    expect(registry.runAction).not.toHaveBeenCalled();
  });

  it('cancelRequested advances the run to CANCELLED before executing anything', async () => {
    const { engine, repo, db, steps } = build({ transition: { toState: 'CANCELLED', action: null } });
    repo.findWithContext.mockResolvedValue({ ...RUN, report: { id: 'r1', cancelRequested: true, state: 'FUNNEL' }, inquiry: null });
    const handler = { execute: jest.fn() };
    steps.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler });
    await engine.executeStep({ runId: 'run1', expectedState: 'SEARCH' });
    expect(handler.execute).not.toHaveBeenCalled();
    expect(db.workflowTransition.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ event: PhaseControlEvent.CANCEL }),
    }));
  });

  it('executes the handler and advances with its outcome event', async () => {
    const { engine, repo, steps } = build();
    steps.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler: { execute: async () => ({ event: 'POOL_READY', dataPatch: { pool: [] } }) } });
    await engine.executeStep({ runId: 'run1', expectedState: 'SEARCH' });
    expect(repo.advanceOptimistic).toHaveBeenCalledWith(expect.objectContaining({ toState: 'MINE' }));
  });

  it('handler throw with attempts remaining → backoff re-enqueue of the SAME step', async () => {
    const { engine, repo, boss, steps } = build();
    steps.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler: { execute: async () => { throw new Error('boom'); } } });
    await engine.executeStep({ runId: 'run1', expectedState: 'SEARCH' });
    expect(repo.bumpAttempts).toHaveBeenCalled();
    expect(boss.enqueue).toHaveBeenCalledWith(expect.objectContaining({ job: QueueJob.PhaseStep, data: { runId: 'run1', expectedState: 'SEARCH' } }));
  });

  it('handler throw with attempts exhausted → STEP_FAILED', async () => {
    const { engine, repo, db, steps } = build({ transition: { toState: 'FAILED', action: null }, run: { ...RUN, attempts: 2 } });
    repo.bumpAttempts.mockResolvedValue({ ...RUN, attempts: 3 });
    steps.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler: { execute: async () => { throw new Error('boom'); } } });
    await engine.executeStep({ runId: 'run1', expectedState: 'SEARCH' });
    expect(db.workflowTransition.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ event: PhaseControlEvent.STEP_FAILED }),
    }));
  });
});
