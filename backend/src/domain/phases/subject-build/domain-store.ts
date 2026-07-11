import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../infra/persistence/prisma.service';
import { DomainPriors } from './domain-knowledge';
import { DomainStore } from './operators.runtime';

/** Only the surface these stores touch — keeps them easy to fake/test. */
type Db = Pick<PrismaService, 'domainKnowledge'>;

const toPriors = (row: { category: string | null; attributes: unknown; sources: unknown; titleHints: unknown; buildCount: number }): DomainPriors => ({
  attributes: (row.attributes as Record<string, unknown>) ?? {},
  sources: (row.sources as string[]) ?? [],
  titleHints: (row.titleHints as string[]) ?? [],
  buildCount: row.buildCount,
  category: row.category,
});

/** The LIVE domain memory (Prisma) — production subject builds read and write it. */
export function prismaDomainStore(db: Db): DomainStore {
  return {
    load: async ({ domain }) => {
      const row = await db.domainKnowledge.findUnique({ where: { domain } });
      return row ? toPriors(row) : null;
    },
    save: async ({ domain, knowledge }) => {
      const fields = {
        category: knowledge.category ?? null,
        attributes: knowledge.attributes as Prisma.InputJsonValue,
        sources: knowledge.sources as Prisma.InputJsonValue,
        titleHints: knowledge.titleHints as Prisma.InputJsonValue,
        buildCount: knowledge.buildCount,
      };
      await db.domainKnowledge.upsert({ where: { domain }, create: { domain, ...fields }, update: fields });
    },
  };
}

/**
 * The REHEARSAL domain memory: real priors in (so candidates are scored with the
 * knowledge production would have), every write DISCARDED — an experiment must
 * never teach the live memory.
 */
export function rehearsalDomainStore(db?: Db): DomainStore {
  const live = db ? prismaDomainStore(db) : null;
  return {
    load: (args) => (live ? live.load(args) : Promise.resolve(null)),
    save: async () => undefined,
  };
}
