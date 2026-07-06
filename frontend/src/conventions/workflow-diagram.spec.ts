import { describe, it, expect } from 'vitest';
import { splitCommonEdges, computeLayers, layoutWorkflow, COLLAPSE_FAN_IN } from './workflow-diagram';

const s = (name: string, opts: { initial?: boolean; terminal?: boolean } = {}) => ({ name, isInitial: !!opts.initial, isTerminal: !!opts.terminal });
const t = (fromState: string, event: string, toState: string) => ({ fromState, event, toState });

// The real report workflow shape (v2), trimmed to what the layout must handle:
// a linear happy path, per-stage failure edges, a CANCEL fan-in, and one back edge.
const STATES = [
  s('RECEIVED', { initial: true }), s('PRE_RESEARCH'), s('QUESTIONNAIRE_SENT'), s('ENRICHMENT'),
  s('BROAD_RESEARCH'), s('FUNNEL'), s('OUTREACH'), s('REPORT_GENERATION'), s('ON_HOLD'),
  s('REPORT_DELIVERED', { terminal: true }), s('DENIED', { terminal: true }), s('FAILED', { terminal: true }), s('CANCELLED', { terminal: true }),
];
const CANCELABLE = ['RECEIVED', 'PRE_RESEARCH', 'QUESTIONNAIRE_SENT', 'ENRICHMENT', 'BROAD_RESEARCH', 'FUNNEL', 'OUTREACH', 'REPORT_GENERATION', 'ON_HOLD'];
const TRANSITIONS = [
  t('RECEIVED', 'START_PRE_RESEARCH', 'PRE_RESEARCH'),
  t('PRE_RESEARCH', 'PRE_RESEARCH_PASSED', 'QUESTIONNAIRE_SENT'),
  t('PRE_RESEARCH', 'PRE_RESEARCH_DENIED', 'DENIED'),
  t('QUESTIONNAIRE_SENT', 'QUESTIONNAIRE_FILLED', 'ENRICHMENT'),
  t('ENRICHMENT', 'ENRICHMENT_DONE', 'BROAD_RESEARCH'),
  t('BROAD_RESEARCH', 'BROAD_RESEARCH_DONE', 'FUNNEL'),
  t('BROAD_RESEARCH', 'REUSE_FOUND', 'REPORT_DELIVERED'),
  t('FUNNEL', 'FUNNEL_BUILT', 'OUTREACH'),
  t('OUTREACH', 'OUTREACH_DONE', 'REPORT_GENERATION'),
  t('OUTREACH', 'HOLD', 'ON_HOLD'),
  t('ON_HOLD', 'RESUME', 'OUTREACH'), // back edge
  t('REPORT_GENERATION', 'REPORT_READY', 'REPORT_DELIVERED'),
  t('REPORT_GENERATION', 'REPORT_FAILED', 'FAILED'),
  ...CANCELABLE.map((from) => t(from, 'CANCEL', 'CANCELLED')),
];

describe('splitCommonEdges — CANCEL-style fan-ins collapse into a note', () => {
  it(`collapses same-event groups of ${COLLAPSE_FAN_IN}+ into one note and keeps the rest drawn`, () => {
    const { drawn, collapsed } = splitCommonEdges(TRANSITIONS);
    expect(collapsed).toEqual([{ event: 'CANCEL', toState: 'CANCELLED', fromCount: CANCELABLE.length }]);
    expect(drawn.some((x) => x.event === 'CANCEL')).toBe(false);
    // Two REPORT_DELIVERED arrivals use different events — below the fan-in bar, both stay drawn.
    expect(drawn.filter((x) => x.toState === 'REPORT_DELIVERED')).toHaveLength(2);
    expect(drawn.length + CANCELABLE.length).toBe(TRANSITIONS.length);
  });
});

describe('computeLayers — longest path from the initial state, cycle-safe', () => {
  const { layers, backEdges } = computeLayers({ states: STATES, transitions: TRANSITIONS });

  it('lays the happy path out in order', () => {
    const path = ['RECEIVED', 'PRE_RESEARCH', 'QUESTIONNAIRE_SENT', 'ENRICHMENT', 'BROAD_RESEARCH', 'FUNNEL', 'OUTREACH', 'REPORT_GENERATION'];
    path.forEach((name, i) => expect(layers.get(name)).toBe(i));
    expect(layers.get('REPORT_DELIVERED')).toBe(8); // longest arrival wins over the BROAD_RESEARCH shortcut
  });

  it('marks ON_HOLD → OUTREACH as a back edge instead of looping', () => {
    const back = [...backEdges];
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ fromState: 'ON_HOLD', toState: 'OUTREACH' });
    expect(layers.get('ON_HOLD')).toBe(7);
  });

  it('terminal sinks land one past their deepest source', () => {
    expect(layers.get('DENIED')).toBe(2);
    expect(layers.get('FAILED')).toBe(8);
    expect(layers.get('CANCELLED')).toBe(8); // via ON_HOLD (7) — deepest cancelable state
  });
});

describe('layoutWorkflow — pixel layout', () => {
  const d = layoutWorkflow({ states: STATES, transitions: TRANSITIONS });

  it('positions every state without overlaps within a layer', () => {
    expect(d.nodes).toHaveLength(STATES.length);
    const byLayer = new Map<number, { y: number; h: number }[]>();
    for (const n of d.nodes) byLayer.set(n.layer, [...(byLayer.get(n.layer) ?? []), n]);
    for (const nodes of byLayer.values()) {
      const sorted = [...nodes].sort((a, b) => a.y - b.y);
      for (let i = 1; i < sorted.length; i += 1) expect(sorted[i].y).toBeGreaterThanOrEqual(sorted[i - 1].y + sorted[i - 1].h);
    }
  });

  it('draws non-collapsed edges only, flags the back edge, and sizes the canvas to fit', () => {
    expect(d.edges.some((e) => e.event === 'CANCEL')).toBe(false);
    expect(d.edges.filter((e) => e.back)).toEqual([{ from: 'ON_HOLD', to: 'OUTREACH', event: 'RESUME', back: true }]);
    for (const n of d.nodes) {
      expect(n.x + n.w).toBeLessThanOrEqual(d.width);
      expect(n.y + n.h).toBeLessThanOrEqual(d.height);
    }
  });

  it('keeps the happy path on the top row (barycenter ordering, flow-continuers win ties)', () => {
    const rowOf = (name: string) => d.nodes.find((n) => n.name === name)!.y;
    for (const name of ['PRE_RESEARCH', 'QUESTIONNAIRE_SENT', 'ENRICHMENT', 'BROAD_RESEARCH', 'FUNNEL', 'OUTREACH', 'REPORT_GENERATION']) {
      expect(rowOf(name)).toBe(rowOf('RECEIVED'));
    }
    expect(rowOf('DENIED')).toBeGreaterThan(rowOf('ENRICHMENT')); // terminal sink hangs below the spine
  });
});
