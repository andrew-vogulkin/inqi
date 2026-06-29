import { WorkflowStatus } from '@inqi/shared';
import { StatusTone } from './enums';
import { WorkflowVersionDto, VersionDiffDto } from '../api/types';

/**
 * FE-15 — workflow versions. Tree/diff derivation lives here (convention #2). The
 * backend identifies workflows by `key` (no WorkflowType enum) and the diff exposes
 * add/remove sets only — a "changed" transition is derived here by pairing a
 * removed + added transition that share (from, event) but retarget `to`.
 */

/** The right-panel toggle. */
export const WorkflowPanel = {
  Diagram: 'diagram',
  Diff: 'diff',
} as const;
export type WorkflowPanel = (typeof WorkflowPanel)[keyof typeof WorkflowPanel];

/** Diff kinds → tokens: added = brand, removed = danger, changed = warn. */
export const DiffKind = {
  Added: 'added',
  Removed: 'removed',
  Changed: 'changed',
} as const;
export type DiffKind = (typeof DiffKind)[keyof typeof DiffKind];

export const DIFF_KIND_TONE: Record<DiffKind, StatusTone> = {
  [DiffKind.Added]: StatusTone.Brand,
  [DiffKind.Removed]: StatusTone.Danger,
  [DiffKind.Changed]: StatusTone.Warn,
};

export function versionStatusTone(status: string): StatusTone {
  switch (status) {
    case WorkflowStatus.Active: return StatusTone.Brand;
    case WorkflowStatus.Draft: return StatusTone.Info;
    case WorkflowStatus.Archived: return StatusTone.Muted;
    default: return StatusTone.Subtle;
  }
}

export interface WorkflowGroup { key: string; versions: WorkflowVersionDto[] }

/** Group flat versions by `key` into a type→version tree (versions newest-first). */
export function buildTree({ versions }: { versions: WorkflowVersionDto[] }): WorkflowGroup[] {
  const byKey = new Map<string, WorkflowVersionDto[]>();
  for (const v of versions) {
    const list = byKey.get(v.key) ?? [];
    list.push(v);
    byKey.set(v.key, list);
  }
  return [...byKey.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([key, list]) => ({ key, versions: [...list].sort((a, b) => b.version - a.version) }));
}

export interface TransitionChange { fromState: string; event: string; before: string; after: string }
export interface DiffViewModel {
  states: { added: string[]; removed: string[] };
  transitions: { added: string[]; removed: string[]; changed: TransitionChange[] };
  isEmpty: boolean;
}

const TRANSITION_RE = /^(.*) --(.*)--> (.*)$/;
function parseTransition(key: string): { fromState: string; event: string; toState: string } | null {
  const m = TRANSITION_RE.exec(key);
  return m ? { fromState: m[1], event: m[2], toState: m[3] } : null;
}

/**
 * Build the colored diff view-model. Pairs a removed + added transition sharing
 * (from, event) into a single "changed" (retargeted `to`); the rest stay add/remove.
 */
export function diffViewModel({ diff }: { diff: VersionDiffDto }): DiffViewModel {
  const addedT = [...diff.transitions.added];
  const removedT = [...diff.transitions.removed];
  const changed: TransitionChange[] = [];

  for (const removedKey of [...removedT]) {
    const r = parseTransition(removedKey);
    if (!r) continue;
    const match = addedT.find((a) => {
      const p = parseTransition(a);
      return p && p.fromState === r.fromState && p.event === r.event && p.toState !== r.toState;
    });
    if (match) {
      const a = parseTransition(match)!;
      changed.push({ fromState: r.fromState, event: r.event, before: r.toState, after: a.toState });
      removedT.splice(removedT.indexOf(removedKey), 1);
      addedT.splice(addedT.indexOf(match), 1);
    }
  }

  const states = { added: diff.states.added, removed: diff.states.removed };
  const transitions = { added: addedT, removed: removedT, changed };
  const isEmpty = !states.added.length && !states.removed.length && !transitions.added.length && !transitions.removed.length && !changed.length;
  return { states, transitions, isEmpty };
}

/**
 * Apply a `workflow.published` swap: the published version → Active, any other
 * Active version of the same key → Archived. Pure; safe to call idempotently.
 */
export function applyPublished({ versions, publishedId }: { versions: WorkflowVersionDto[]; publishedId: string }): WorkflowVersionDto[] {
  const published = versions.find((v) => v.id === publishedId);
  if (!published || published.status === WorkflowStatus.Active) return versions;
  return versions.map((v) => {
    if (v.id === publishedId) return { ...v, status: WorkflowStatus.Active };
    if (v.key === published.key && v.status === WorkflowStatus.Active) return { ...v, status: WorkflowStatus.Archived };
    return v;
  });
}
