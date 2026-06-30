import { Injectable } from '@nestjs/common';
import { AuditAction, AuditTargetType, WorkflowStatus } from '@inqi/shared';
import { ConflictError, ErrorCode, NotFoundError } from '../../common/errors';
import { AuditService } from '../../infra/observability/audit.service';
import { WorkflowAdminRepository } from './workflow-admin.repository';
import { GraphState, GraphTransition, WorkflowGraph, diffVersions, validateWorkflowGraph } from './workflow-graph';

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
 * versions are immutable, new inquiries pick the active version, and in-flight
 * inquiries stay pinned to theirs.
 */
@Injectable()
export class WorkflowAdminService {
  constructor(private readonly repo: WorkflowAdminRepository, private readonly audit: AuditService) {}

  async list() {
    const [defs, pinned] = await Promise.all([this.repo.listDefinitions(), this.repo.pinnedCounts()]);
    return defs.map((d) => ({ id: d.id, key: d.key, version: d.version, status: d.status, createdAt: d.createdAt, pinnedInquiries: pinned.get(d.id) ?? 0 }));
  }

  async inspect({ id }: { id: string }) {
    const def = await this.repo.findWithGraph({ id });
    if (!def) throw new NotFoundError({ code: ErrorCode.NotFound, message: 'workflow version not found' });
    const graph = toGraph(def);
    return {
      id: def.id, key: def.key, version: def.version, status: def.status,
      states: graph.states, transitions: graph.transitions,
      validation: validateWorkflowGraph(graph),
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
    await this.repo.publish({ id, key: def.key });
    await this.audit.record({ actor, action: AuditAction.PublishWorkflow, targetType: AuditTargetType.Workflow, targetId: id, data: { key: def.key, version: def.version } });
    return { id, version: def.version, status: WorkflowStatus.Active, alreadyActive: false };
  }
}
