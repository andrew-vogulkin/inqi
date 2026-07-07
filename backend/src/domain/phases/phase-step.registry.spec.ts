import { PhaseKey } from '@inqi/shared';
import { PhaseStepRegistry, StepHandler, WILDCARD_STATE } from './phase-step.tokens';

const h = (id: string): StepHandler => ({ execute: async () => ({ event: id }) });

describe('PhaseStepRegistry — exact + wildcard', () => {
  it('prefers an exact (key,state) match; falls back to the per-key wildcard; else null', async () => {
    const reg = new PhaseStepRegistry();
    reg.register({ key: PhaseKey.BreadthSearch, state: 'SEARCH', handler: h('exact') });
    reg.register({ key: PhaseKey.BreadthSearch, state: WILDCARD_STATE, handler: h('wild') });

    expect((await reg.find({ key: PhaseKey.BreadthSearch, state: 'SEARCH' })!.execute({} as never)).event).toBe('exact');
    expect((await reg.find({ key: PhaseKey.BreadthSearch, state: 'ANY_AUTHORED_NAME' })!.execute({} as never)).event).toBe('wild');
    expect(reg.find({ key: PhaseKey.DepthSearch, state: 'X' })).toBeNull(); // different key, no wildcard
  });
});
