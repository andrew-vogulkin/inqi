import { BreadthState, DepthState, PhaseKey } from '@inqi/shared';
import { configuredTunables, validatePhaseTunables } from './phase-tunables';

describe('configuredTunables', () => {
  it('an unconfigured graph pins nothing (behaviour-neutral)', () => {
    const states = [{ name: BreadthState.SEARCH }, { name: BreadthState.CHECKPOINT, config: {} }];
    expect(configuredTunables({ key: PhaseKey.BreadthSearch, states })).toEqual({});
  });

  it('reads genes from their carrying state and clamps to hard bounds', () => {
    const states = [
      { name: BreadthState.SEARCH, config: { poolCap: 100 } },       // > max 40 → clamped
      { name: BreadthState.CHECKPOINT, config: { maxCycles: 4, dryRoundsToStop: 3 } },
    ];
    expect(configuredTunables({ key: PhaseKey.BreadthSearch, states })).toEqual({ poolCap: 40, maxCycles: 4, dryRoundsToStop: 3 });
  });

  it('a gene on the WRONG state (or an unknown key / non-number) is ignored', () => {
    const states = [
      { name: BreadthState.SEARCH, config: { maxCycles: 4, layer: 2, poolCap: 'ten' } }, // maxCycles lives on CHECKPOINT
    ];
    expect(configuredTunables({ key: PhaseKey.BreadthSearch, states })).toEqual({});
  });

  it('a non-registered phase key resolves nothing', () => {
    expect(configuredTunables({ key: 'pre_research', states: [{ name: 'SUBJECT', config: { maxCycles: 3 } }] })).toEqual({});
  });
});

describe('validatePhaseTunables (the publish gate)', () => {
  it('accepts in-bounds genes on their carrying states', () => {
    const states = [
      { name: DepthState.SEARCH_LEADS, config: { leadsCap: 8 } },
      { name: DepthState.GATE, config: { stallPatience: 2 } },
    ];
    expect(validatePhaseTunables({ key: PhaseKey.DepthSearch, states })).toEqual({ valid: true, errors: [] });
  });

  it('rejects unknown keys, wrong-state genes, non-integers and out-of-bounds values', () => {
    const states = [
      { name: DepthState.SEARCH_LEADS, config: { leadsCap: 99, frobnicate: 1 } },
      { name: DepthState.GATE, config: { stallPatience: 1.5 } },
      { name: DepthState.INVESTIGATE, config: { leadsCap: 8 } }, // leadsCap lives on SEARCH_LEADS
    ];
    const res = validatePhaseTunables({ key: PhaseKey.DepthSearch, states });
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/leadsCap=99 out of bounds/);
    expect(res.errors.join(' ')).toMatch(/"frobnicate" is not a registered/);
    expect(res.errors.join(' ')).toMatch(/stallPatience must be an integer/);
    expect(res.errors.join(' ')).toMatch(/INVESTIGATE.*"leadsCap" is not a registered/);
  });

  it('non-phase keys pass through untouched (subject_build has its own validator)', () => {
    expect(validatePhaseTunables({ key: 'subject_build', states: [{ name: 'x', config: { anything: 'goes' } }] }).valid).toBe(true);
  });
});
