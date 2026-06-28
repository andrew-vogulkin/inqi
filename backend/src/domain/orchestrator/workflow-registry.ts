import { QueueJob } from '@inqi/shared';
import { BossService } from '../../infra/queue/boss.service';

/**
 * Named actions/guards referenced by DB transitions. Add a new handler here and
 * wire it from a *new* workflow version — never breaking-edit an existing one.
 */
export const WorkflowAction = {
  EnqueuePreResearch: 'enqueue:pre_research',
  SendQuestionnaire: 'send:questionnaire',
  EnqueueEnrichSubject: 'enqueue:enrich_subject',
  EnqueueBroadResearch: 'enqueue:broad_research',
  EnqueueBuildFunnel: 'enqueue:build_funnel',
  EnqueueStartOutreach: 'enqueue:start_outreach',
  EnqueueGenerateReport: 'enqueue:generate_report',
} as const;
export type WorkflowAction = (typeof WorkflowAction)[keyof typeof WorkflowAction];

export interface ActionCtx {
  inquiryId: string;
  boss: BossService;
  payload?: unknown;
}

const enqueue = (job: QueueJob) => async ({ inquiryId, boss }: ActionCtx): Promise<void> => {
  await boss.enqueue({ job, data: { inquiryId } });
};

export const Actions: Record<string, (ctx: ActionCtx) => Promise<void>> = {
  [WorkflowAction.EnqueuePreResearch]: enqueue(QueueJob.PreResearch),
  [WorkflowAction.SendQuestionnaire]: enqueue(QueueJob.SendQuestionnaire),
  [WorkflowAction.EnqueueEnrichSubject]: enqueue(QueueJob.EnrichSubject),
  [WorkflowAction.EnqueueBroadResearch]: enqueue(QueueJob.BroadResearch),
  [WorkflowAction.EnqueueBuildFunnel]: enqueue(QueueJob.BuildFunnel),
  [WorkflowAction.EnqueueStartOutreach]: enqueue(QueueJob.StartOutreach),
  [WorkflowAction.EnqueueGenerateReport]: enqueue(QueueJob.GenerateReport),
};

export const Guards: Record<string, (ctx: ActionCtx) => Promise<boolean>> = {
  // e.g. 'budget:present': async ({ payload }) => (payload as { budgetMax?: number })?.budgetMax != null,
};
