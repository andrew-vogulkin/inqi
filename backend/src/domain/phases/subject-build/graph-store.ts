import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/persistence/prisma.service';
import { DEFAULT_GRAPH } from './operators';
import { SubjectBuildGraph } from './validate';

export const SUBJECT_BUILD_KEY = 'subject_build';

/** Only the workflow surface these helpers touch — keeps them easy to fake/test. */
type Db = Pick<PrismaService, 'workflowDefinition'>;

/** The active subject_build composition, or the code default (IN → enrich-basic → OUT) if none is seeded. */
export async function loadActiveSubjectBuildGraph(db: Db): Promise<SubjectBuildGraph> {
  const def = await db.workflowDefinition.findFirst({
    where: { key: SUBJECT_BUILD_KEY, status: 'active' }, orderBy: { version: 'desc' }, include: { states: true, transitions: true },
  });
  if (!def) return DEFAULT_GRAPH as unknown as SubjectBuildGraph;
  return {
    states: def.states.map((s) => ({ name: s.name, handler: s.handler ?? undefined, config: (s.config as SubjectBuildGraph['states'][number]['config']) ?? undefined, isInitial: s.isInitial, isTerminal: s.isTerminal })),
    transitions: def.transitions.map((t) => ({ from: t.fromState, to: t.toState, event: t.event })),
  };
}

/** Persist a candidate composition as the next DRAFT version. The operator reviews + publishes it — we never activate it here. */
export async function saveDraftSubjectBuildVersion(db: Db, candidate: SubjectBuildGraph): Promise<{ id: string; version: number }> {
  const latest = await db.workflowDefinition.findFirst({ where: { key: SUBJECT_BUILD_KEY }, orderBy: { version: 'desc' }, select: { version: true } });
  const version = (latest?.version ?? 0) + 1;
  const def = await db.workflowDefinition.create({
    data: {
      key: SUBJECT_BUILD_KEY, version, status: 'draft',
      // A composed `layer` rides in config (WorkflowState has no layer column) — the loader and validator read it back from there.
      states: {
        create: candidate.states.map((s) => {
          const config = s.layer != null ? { ...(s.config ?? {}), layer: s.layer } : s.config;
          return { name: s.name, isInitial: !!s.isInitial, isTerminal: !!s.isTerminal, handler: s.handler ?? null, config: (config as Prisma.InputJsonValue) ?? Prisma.JsonNull };
        }),
      },
      transitions: { create: candidate.transitions.map((t) => ({ fromState: t.from, toState: t.to, event: t.event })) },
    },
  });
  return { id: def.id, version };
}
