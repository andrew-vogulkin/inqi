/** The decision the agent reaches after reading a subject-provider's reply. */
export const ReplyIntent = {
  Continue: 'continue',
  Qualify: 'qualify',
  Disqualify: 'disqualify',
  Escalate: 'escalate',
} as const;
export type ReplyIntent = (typeof ReplyIntent)[keyof typeof ReplyIntent];

export interface ReplyDecision {
  intent: ReplyIntent;
  result?: Record<string, unknown>;
  draft?: string;
  reason?: string;
}
