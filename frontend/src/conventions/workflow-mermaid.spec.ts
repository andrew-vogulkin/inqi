import { describe, it, expect } from 'vitest';
import { toMermaidSource } from './workflow-mermaid';

const s = (name: string, opts: { initial?: boolean; terminal?: boolean } = {}) => ({ name, isInitial: !!opts.initial, isTerminal: !!opts.terminal });
const t = (fromState: string, event: string, toState: string) => ({ fromState, event, toState });

describe('toMermaidSource — workflow graph → stateDiagram-v2', () => {
  const STATES = [s('RECEIVED', { initial: true }), s('OUTREACH'), s('DONE', { terminal: true }), s('CANCELLED', { terminal: true })];
  const TRANSITIONS = [
    t('RECEIVED', 'GO', 'OUTREACH'),
    t('OUTREACH', 'FINISH', 'DONE'),
    ...['RECEIVED', 'OUTREACH', 'DONE', 'A5'].map((from) => t(from, 'CANCEL', 'CANCELLED')),
  ];

  it('emits an LR state diagram with the initial marker and labeled transitions', () => {
    const { source } = toMermaidSource({ states: STATES, transitions: TRANSITIONS });
    expect(source).toContain('stateDiagram-v2');
    expect(source).toContain('direction LR');
    expect(source).toContain('[*] --> RECEIVED');
    expect(source).toContain('RECEIVED --> OUTREACH: GO');
    expect(source).toContain('OUTREACH --> DONE: FINISH');
  });

  it('collapses the CANCEL fan-in out of the source and reports it', () => {
    const { source, collapsed } = toMermaidSource({ states: STATES, transitions: TRANSITIONS });
    expect(source).not.toMatch(/: CANCEL$/m); // no CANCEL transition lines (state name still appears in classDef)
    expect(collapsed).toEqual([{ event: 'CANCEL', toState: 'CANCELLED', fromCount: 4 }]);
  });

  it('styles terminal states via classDef', () => {
    const { source } = toMermaidSource({ states: STATES, transitions: TRANSITIONS });
    expect(source).toContain('classDef terminal');
    expect(source).toContain('class DONE,CANCELLED terminal');
  });

  it('aliases hyphenated names to parse-safe ids (subject_build operators)', () => {
    const { source } = toMermaidSource({
      states: [s('SUBJECT_IN', { initial: true }), s('enrich-web-grounded'), s('SUBJECT_OUT', { terminal: true })],
      transitions: [t('SUBJECT_IN', 'READY', 'enrich-web-grounded'), t('enrich-web-grounded', 'DRAFTED', 'SUBJECT_OUT')],
    });
    expect(source).toContain('state "enrich-web-grounded" as enrich_web_grounded');
    expect(source).toContain('SUBJECT_IN --> enrich_web_grounded: READY');
    expect(source).not.toMatch(/ enrich-web-grounded -->/); // raw hyphenated id never used as a node
  });

  it('renders per-state config (genes / layer) as an attached note', () => {
    const { source } = toMermaidSource({
      states: [
        { ...s('SEARCH', { initial: true }), config: { poolCap: 12 } },
        { ...s('CHECKPOINT'), config: { dryRoundsToStop: 3, maxCycles: 4, predicate: 'low-confidence', nested: { ignored: true } } },
        s('DONE', { terminal: true }),
      ],
      transitions: [t('SEARCH', 'POOL_READY', 'CHECKPOINT'), t('CHECKPOINT', 'TARGET_MET', 'DONE')],
    });
    expect(source).toContain('note right of SEARCH');
    expect(source).toContain('poolCap=12');
    expect(source).toContain('dryRoundsToStop=3 · maxCycles=4 · predicate=low-confidence');
    expect(source).not.toContain('nested'); // non-scalars stay out of the drawing
  });

  it('shows registry defaults on gene-carrying states even when the version sets nothing', () => {
    const tunables = [
      { key: 'leadsCap', state: 'SEARCH_LEADS', min: 4, max: 20, fallback: 12, describe: 'leads' },
      { key: 'maxCycles', state: 'INVESTIGATE', min: 1, max: 6, fallback: null, describe: 'cycles' },
      { key: 'poolCap', state: 'SEARCH_LEADS', min: 8, max: 40, fallback: 24, describe: 'pool' },
    ];
    const { source } = toMermaidSource({
      states: [s('SEARCH_LEADS', { initial: true }), { ...s('INVESTIGATE'), config: { maxCycles: 3 } }, s('DONE', { terminal: true })],
      transitions: [t('SEARCH_LEADS', 'LEADS_READY', 'INVESTIGATE'), t('INVESTIGATE', 'CYCLE_CAP', 'DONE')],
      tunables,
    });
    // unset genes render as defaults (null fallback = caller-computed → "auto")
    expect(source).toContain('leadsCap=12 (default) · poolCap=24 (default)');
    // a SET gene wins over its registry default — no duplicate entry
    expect(source).toContain('maxCycles=3');
    expect(source).not.toContain('maxCycles=auto');
  });
});
