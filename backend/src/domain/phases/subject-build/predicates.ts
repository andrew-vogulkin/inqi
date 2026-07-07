import { SubjectCategory } from '@inqi/shared';
import { Predicate } from './operators';
import { SubjectBuildData } from './draft';

/** An if-else predicate: pure over the run scratchpad + the state's config. Registered by id. */
export type SubjectPredicate = (data: SubjectBuildData, config?: Record<string, unknown>) => boolean;

const asNumber = (v: unknown, fallback: number): number => (typeof v === 'number' ? v : fallback);

/**
 * The registered predicate palette an `if-else` state selects from (by id in its
 * config). No free expressions — same "reference code by name" safety as guards.
 */
export const PREDICATE_FNS: Record<Predicate, SubjectPredicate> = {
  // draft confidence below a (config-tunable) threshold → take the refine branch
  'low-confidence': (d, cfg) => (d.draft.confidence ?? 0) < asNumber(cfg?.threshold, 0.5),
  // a builder has already produced a draft title
  'has-draft': (d) => !!d.draft.title?.trim(),
  // the subject is a service (steer category-specialize / sourcing)
  'category-is-service': (d) => d.draft.category === SubjectCategory.Service,
  // a target-industry-set operator has populated reference sources
  'has-reference-set': (d) => (d.referenceSet?.length ?? 0) > 0,
};

/** Evaluate a registered predicate; unknown id → false (validator forbids this at publish). */
export function evalPredicate({ id, data, config }: { id: string; data: SubjectBuildData; config?: Record<string, unknown> }): boolean {
  const fn = PREDICATE_FNS[id as Predicate];
  return fn ? fn(data, config) : false;
}
