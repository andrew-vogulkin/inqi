import { BossService } from '../queue/boss.service';

/** Named actions/guards referenced by DB transitions. Add here, wire from a new
 *  workflow version — never breaking-edit an existing version. */
export type ActionCtx = { inquiryId: string; boss: BossService; payload?: any };

export const Actions: Record<string, (ctx: ActionCtx) => Promise<void>> = {
  'enqueue:pre_research':   ({ inquiryId, boss }) => boss.enqueue('pre_research', { inquiryId }),
  'send:questionnaire':     ({ inquiryId, boss }) => boss.enqueue('send_questionnaire', { inquiryId }),
  'enqueue:enrich_subject': ({ inquiryId, boss }) => boss.enqueue('enrich_subject', { inquiryId }),
  'enqueue:broad_research': ({ inquiryId, boss }) => boss.enqueue('broad_research', { inquiryId }),
  'enqueue:build_funnel':   ({ inquiryId, boss }) => boss.enqueue('build_funnel', { inquiryId }),
  'enqueue:start_outreach': ({ inquiryId, boss }) => boss.enqueue('start_outreach', { inquiryId }),
  'enqueue:generate_report':({ inquiryId, boss }) => boss.enqueue('generate_report', { inquiryId }),
};

export const Guards: Record<string, (ctx: ActionCtx) => Promise<boolean>> = {
  // e.g. 'budget:present': async ({ payload }) => payload?.budgetMax != null,
};
