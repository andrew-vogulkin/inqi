import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, WorkflowStatus } from '@inqi/shared';
import { ConflictError, ErrorCode, NotFoundError } from '../../common/errors';
import { AuditService } from '../../infra/observability/audit.service';
import { WorkflowAdminRepository } from './workflow-admin.repository';
import { GraphState, GraphTransition, WorkflowGraph, ambiguousTransitions, diffVersions, validateWorkflowGraph } from './workflow-graph';
import { SubjectBuildGraph, validateSubjectBuildGraph } from '../phases/subject-build/validate';
import { PHASE_TUNABLES, validatePhaseTunables } from '../phases/phase-tunables';

const SUBJECT_BUILD_KEY = 'subject_build';

/** Map a stored definition (with per-state handler/config) to the subject_build validator's shape. */
function toSubjectBuildGraph(def: { states: { name: string; isInitial: boolean; isTerminal: boolean }[]; transitions: { fromState: string; toState: string; event: string }[] }): SubjectBuildGraph {
  return {
    states: def.states.map((s) => {
      const row = s as { name: string; isInitial: boolean; isTerminal: boolean; handler?: string | null; config?: unknown };
      return { name: row.name, isInitial: row.isInitial, isTerminal: row.isTerminal, handler: row.handler ?? undefined, config: (row.config as SubjectBuildGraph['states'][number]['config']) ?? undefined };
    }),
    transitions: def.transitions.map((t) => ({ from: t.fromState, to: t.toState, event: t.event })),
  };
}

/** Map a definition's DB rows to the pure-graph shape. */
function toGraph(def: { states: { name: string; isInitial: boolean; isTerminal: boolean }[]; transitions: { fromState: string; toState: string; event: string }[] }): WorkflowGraph {
  return {
    states: def.states.map((s): GraphState => ({ name: s.name, isInitial: s.isInitial, isTerminal: s.isTerminal })),
    transitions: def.transitions.map((t): GraphTransition => ({ fromState: t.fromState, toState: t.toState, event: t.event })),
  };
}

/**
 * Workflow-version management (HP-12): list/inspect/diff and a safe, validated,
 * audited publish. The workflow stays DB-stored + versioned; active/archived
 * versions are immutable, new reports pick the active version, and in-flight
 * reports stay pinned to theirs.
 */
@Injectable()
export class WorkflowAdminService {
  constructor(private readonly repo: WorkflowAdminRepository, private readonly audit: AuditService) {}

  async list() {
    const [defs, pinned] = await Promise.all([this.repo.listDefinitions(), this.repo.pinnedCounts()]);
    return defs.map((d) => ({ id: d.id, key: d.key, version: d.version, status: d.status, createdAt: d.createdAt, pinnedReports: pinned.get(d.id) ?? 0 }));
  }

  async inspect({ id }: { id: string }) {
    const def = await this.repo.findWithGraph({ id });
    if (!def) throw new NotFoundError({ code: ErrorCode.NotFound, message: 'workflow version not found' });
    const graph = toGraph(def);
    return {
      id: def.id, key: def.key, version: def.version, status: def.status,
      // handler/config ride along so the diagram can show operator bindings + tuned genes.
      states: def.states.map((st) => {
        const row = st as { name: string; isInitial: boolean; isTerminal: boolean; handler?: string | null; config?: unknown };
        return { name: row.name, isInitial: row.isInitial, isTerminal: row.isTerminal, handler: row.handler ?? null, config: (row.config as Record<string, unknown> | null) ?? null };
      }),
      transitions: graph.transitions,
      validation: validateWorkflowGraph(graph),
      // The phase's tunable-gene registry (bounds + fallbacks) — the diagram shows
      // defaults on gene-carrying states even when a version sets nothing.
      tunables: PHASE_TUNABLES[def.key] ?? [],
    };
  }

  /** Diff a version against the current active version of its key. */
  async diff({ id }: { id: string }) {
    const def = await this.repo.findWithGraph({ id });
    if (!def) throw new NotFoundError({ code: ErrorCode.NotFound, message: 'workflow version not found' });
    const active = await this.repo.findActive({ key: def.key });
    const base: WorkflowGraph = active ? toGraph(active) : { states: [], transitions: [] };
    return {
      from: active ? { id: active.id, version: active.version } : null,
      to: { id: def.id, version: def.version },
      diff: diffVersions({ a: base, b: toGraph(def) }),
    };
  }

  /** Validate the graph, then transactionally activate the version (idempotent if already active). Audited. */
  async publish({ id, actor }: { id: string; actor: string }) {
    const def = await this.repo.findWithGraph({ id });
    if (!def) throw new NotFoundError({ code: ErrorCode.NotFound, message: 'workflow version not found' });
    if (def.status === WorkflowStatus.Active) return { id, version: def.version, status: WorkflowStatus.Active, alreadyActive: true };

    const validation = validateWorkflowGraph(toGraph(def));
    if (!validation.valid) {
      throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: 'cannot publish an invalid workflow graph', details: { errors: validation.errors } });
    }
    // Composable phases get an extra, operator-aware gate (typed I/O, the persist
    // invariant, the operator budget) before a candidate composition can go live.
    if (def.key === SUBJECT_BUILD_KEY) {
      const sb = validateSubjectBuildGraph(toSubjectBuildGraph(def));
      if (!sb.valid) {
        throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: 'cannot publish an invalid subject_build composition', details: { errors: sb.errors } });
      }
    } else {
      // ENGINE-RUN workflows must stay deterministic: one transition per (state, event).
      // The DB unique key no longer enforces this (it gained toState so subject_build
      // networks can fan out), so the publish gate carries the invariant now.
      const ambiguous = ambiguousTransitions(toGraph(def).transitions);
      if (ambiguous.length) {
        throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: 'cannot publish an engine-run workflow with ambiguous transitions (same state + event twice)', details: { ambiguous } });
      }
      // Stage-1 evolution: state-config genes must be registered tunables within bounds.
      const tunables = validatePhaseTunables({ key: def.key, states: def.states as { name: string; config?: unknown }[] });
      if (!tunables.valid) {
        throw new ConflictError({ code: ErrorCode.InvalidWorkflowTransition, message: 'cannot publish out-of-bounds phase tunables', details: { errors: tunables.errors } });
      }
    }
    await this.repo.publish({ id, key: def.key });
    await this.audit.record({ actor, action: AuditAction.PublishWorkflow, targetType: AuditTargetType.Workflow, targetId: id, data: { key: def.key, version: def.version } });
    return { id, version: def.version, status: WorkflowStatus.Active, alreadyActive: false };
  }
}
