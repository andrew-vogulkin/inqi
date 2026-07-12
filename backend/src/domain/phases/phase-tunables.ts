import { BreadthState, DepthState, PhaseKey, READY_MIN, ReportState } from '@inqi/shared';

/**
 * The TUNABLE-PARAMETER registries for the engine-run research phases — stage 1
 * of docs/research-phase-evolution.md. Each gene is a numeric knob a proposal
 * may set in its state's `WorkflowState.config`, within hard bounds. The engine
 * pins configured values into `run.data` at startRun (runs stay self-contained
 * and replayable); handlers read `run.data.<key> ?? <code constant>`, so an
 * unconfigured graph behaves exactly as today.
 */
export interface TunableSpec {
  /** Gene name — also the `run.data` key the step handlers read. */
  key: string;
  /** The state whose `config` carries the gene (its consumer — the storage address). */
  state: string;
  min: number;
  max: number;
  /** Today's behaviour, for docs/prompts. `null` = the caller computes it (config-service / context). */
  fallback: number | null;
  describe: string;
}

/** The parent report machine's workflow key — its genes ride the same registry. */
export const REPORT_WORKFLOW_KEY = 'report';

export const PHASE_TUNABLES: Partial<Record<string, TunableSpec[]>> = {
  // The report lifecycle is run by WorkflowEngine, not PhaseEngine, so there is
  // no run.data to pin into — consumers resolve these at action time through the
  // report's pinned version (ReportTunablesService). Registry + bounds + publish
  // gate + diagram notes are shared with the phases.
  [REPORT_WORKFLOW_KEY]: [
    { key: 'targetQualifiedOptions', state: ReportState.FUNNEL, min: 2, max: 8, fallback: READY_MIN, describe: 'qualified options that stop outreach (pinned into the Epic)' },
    { key: 'firstWave', state: ReportState.FUNNEL, min: 1, max: 4, fallback: 1, describe: 'size of the first escalating wave' },
    { key: 'waveGrowth', state: ReportState.FUNNEL, min: 2, max: 4, fallback: 3, describe: 'escalation multiplier — waves are [w, w·g, w·g²]' },
    { key: 'breadthCap', state: ReportState.FUNNEL, min: 4, max: 16, fallback: null, describe: 'max breadth inquiries per report (env BREADTH_MAX_INQUIRIES)' },
    { key: 'widenBatch', state: ReportState.OUTREACH, min: 2, max: 8, fallback: 6, describe: 'candidates asked of a widen breadth run' },
    { key: 'replyTimeoutMinutes', state: ReportState.OUTREACH, min: 30, max: 1440, fallback: null, describe: 'silence before an inquiry is marked unresponsive (env REPLY_TIMEOUT_MINUTES)' },
  ],
  [PhaseKey.BreadthSearch]: [
    { key: 'maxCycles', state: BreadthState.CHECKPOINT, min: 1, max: 8, fallback: null, describe: 'search→mine→qualify cycles before CAP_REACHED' },
    { key: 'poolCap', state: BreadthState.SEARCH, min: 8, max: 40, fallback: 24, describe: 'web hits kept per search cycle' },
    { key: 'dryRoundsToStop', state: BreadthState.CHECKPOINT, min: 1, max: 4, fallback: 2, describe: 'consecutive zero-gain rounds before WENT_DRY' },
  ],
  [PhaseKey.DepthSearch]: [
    { key: 'maxCycles', state: DepthState.INVESTIGATE, min: 1, max: 6, fallback: null, describe: 'investigate→gate refine cycles before CYCLE_CAP' },
    { key: 'maxToolCalls', state: DepthState.INVESTIGATE, min: 2, max: 12, fallback: null, describe: 'agent tool budget per investigate cycle' },
    { key: 'leadsCap', state: DepthState.SEARCH_LEADS, min: 4, max: 20, fallback: 12, describe: 'search leads seeding the first cycle' },
    { key: 'stallPatience', state: DepthState.GATE, min: 1, max: 4, fallback: 2, describe: 'no-new-evidence cycles before STALLED' },
    { key: 'webRoom', state: DepthState.FORM_QUERIES, min: 2, max: 12, fallback: null, describe: 'web budget for fallback/persist enrichment' },
  ],
};

type ConfiguredState = { name: string; config?: unknown };

const specFor = (key: string): Map<string, TunableSpec> =>
  new Map((PHASE_TUNABLES[key] ?? []).map((t) => [`${t.state}:${t.key}`, t]));

/**
 * The gene values a definition's state configs actually set (validated ones
 * only — bounds are the publish gate's job; here out-of-range values are
 * clamped so a bad row can never exceed a hard bound at runtime).
 */
export function configuredTunables({ key, states }: { key: string; states: ConfiguredState[] }): Record<string, number> {
  const specs = specFor(key);
  const out: Record<string, number> = {};
  for (const s of states) {
    const config = (s.config ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(config)) {
      const spec = specs.get(`${s.name}:${k}`);
      if (!spec || typeof v !== 'number' || !Number.isFinite(v)) continue;
      out[spec.key] = Math.min(spec.max, Math.max(spec.min, Math.round(v)));
    }
  }
  return out;
}

/**
 * Publish-gate validation for a phase definition's tunables: every config key on
 * a breadth/depth state must be a registered gene for THAT state, numeric, and
 * within bounds. (subject_build has its own validator; other keys aren't here.)
 */
export function validatePhaseTunables({ key, states }: { key: string; states: ConfiguredState[] }): { valid: boolean; errors: string[] } {
  const specs = specFor(key);
  if (!PHASE_TUNABLES[key]) return { valid: true, errors: [] };
  const errors: string[] = [];
  for (const s of states) {
    const config = (s.config ?? {}) as Record<string, unknown>;
    for (const [k, v] of Object.entries(config)) {
      const spec = specs.get(`${s.name}:${k}`);
      if (!spec) { errors.push(`state "${s.name}" config key "${k}" is not a registered ${key} tunable`); continue; }
      if (typeof v !== 'number' || !Number.isInteger(v)) { errors.push(`tunable ${s.name}.${k} must be an integer (got ${JSON.stringify(v)})`); continue; }
      if (v < spec.min || v > spec.max) errors.push(`tunable ${s.name}.${k}=${v} out of bounds (${spec.min}..${spec.max})`);
    }
  }
  return { valid: errors.length === 0, errors };
}
