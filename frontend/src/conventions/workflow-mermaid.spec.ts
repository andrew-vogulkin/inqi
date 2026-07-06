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
});
