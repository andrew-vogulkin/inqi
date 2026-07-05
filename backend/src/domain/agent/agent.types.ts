/** The decision the agent reaches after reading a subject-provider's reply. */
export const ReplyIntent = {
  Continue: 'continue',
  Qualify: 'qualify',
  Disqualify: 'disqualify',
  Escalate: 'escalate',
} as const;
export type ReplyIntent = (typeof ReplyIntent)[keyof typeof ReplyIntent];

/** Where the answer step sourced each answer to a provider question (priority order). */
export const AnswerSource = {
  Prompt: 'prompt',
  Questionnaire: 'questionnaire',
  Imagination: 'imagination',
} as const;
export type AnswerSource = (typeof AnswerSource)[keyof typeof AnswerSource];

export interface ReplyDecision {
  intent: ReplyIntent;
  result?: Record<string, unknown>;
  draft?: string;
  reason?: string;
}
