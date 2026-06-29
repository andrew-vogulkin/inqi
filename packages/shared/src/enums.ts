/**
 * Shared enums / const unions. The single source of truth for every status,
 * state, kind, tier and strategy used across the backend and frontend.
 *
 * Rule (CLAUDE.md "no magic strings"): never compare against a bare string
 * literal — always reference one of these. Values mirror the DB string columns
 * in `backend/prisma/schema.prisma` exactly, so they double as the DB contract.
 */

/** Subtask lifecycle (`Subtask.status`). */
export const SubtaskStatus = {
  Pending: 'pending',
  Researching: 'researching',
  Contacted: 'contacted',
  Replied: 'replied',
  Qualified: 'qualified',
  Failed: 'failed',
  /** Released-never: the epic stopped early (target met), so this wave was never sent. Terminal, distinct from failed. */
  Skipped: 'skipped',
} as const;
export type SubtaskStatus = (typeof SubtaskStatus)[keyof typeof SubtaskStatus];

/** Conversation state of a subtask email thread (`Subtask.convState`). */
export const ConvState = {
  Idle: 'idle',
  AwaitingReply: 'awaiting_reply',
  NeedsAction: 'needs_action',
  Closed: 'closed',
} as const;
export type ConvState = (typeof ConvState)[keyof typeof ConvState];

/** Dynamic-report finding kinds (`Finding.kind`). */
export const FindingKind = {
  Option: 'option',
  SubjectProviderBackground: 'subject_provider_background',
  Constraint: 'constraint',
  Note: 'note',
} as const;
export type FindingKind = (typeof FindingKind)[keyof typeof FindingKind];

/** Compliance / questionnaire review gate (`reviewStatus`). */
export const ReviewStatus = {
  Pending: 'pending',
  Passed: 'passed',
  Blocked: 'blocked',
  /** Scorer was unavailable/errored and the gate ran fail-open — recorded for audit, not a real pass. */
  Unscored: 'unscored',
} as const;
export type ReviewStatus = (typeof ReviewStatus)[keyof typeof ReviewStatus];

/** Result of the compliance scorer — a settled review outcome (never `pending`). */
export type ComplianceStatus = typeof ReviewStatus.Passed | typeof ReviewStatus.Blocked | typeof ReviewStatus.Unscored;

/** What is being compliance-scored — lets the rubric adapt its prompt. */
export const ComplianceKind = {
  Email: 'email',
  Questionnaire: 'questionnaire',
} as const;
export type ComplianceKind = (typeof ComplianceKind)[keyof typeof ComplianceKind];

/** Ethical/legal risk categories the compliance gate can flag. */
export const ComplianceCategory = {
  IllegalGoods: 'illegal_goods',
  Weapons: 'weapons',
  Drugs: 'drugs',
  Counterfeit: 'counterfeit',
  Adult: 'adult',
  Hate: 'hate',
  Privacy: 'privacy',
  Fraud: 'fraud',
  Malware: 'malware',
  SelfHarm: 'self_harm',
  Other: 'other',
} as const;
export type ComplianceCategory = (typeof ComplianceCategory)[keyof typeof ComplianceCategory];

/** What the compliance gate does when the scorer is unavailable or errors. */
export const ComplianceFailMode = {
  /** Allow on failure (dev/demo default). */
  Open: 'open',
  /** Block on failure (safer for production). */
  Closed: 'closed',
} as const;
export type ComplianceFailMode = (typeof ComplianceFailMode)[keyof typeof ComplianceFailMode];

/** Direction of an email message (`InquiryMessage.direction`). */
export const MessageDirection = {
  Outbound: 'outbound',
  Inbound: 'inbound',
} as const;
export type MessageDirection = (typeof MessageDirection)[keyof typeof MessageDirection];

/** Delivery status of an email message (`InquiryMessage.status`). */
export const MessageStatus = {
  Draft: 'draft',
  Sent: 'sent',
  Delivered: 'delivered',
  Received: 'received',
  Bounced: 'bounced',
} as const;
export type MessageStatus = (typeof MessageStatus)[keyof typeof MessageStatus];

/** Message channel (`InquiryMessage.channel`). */
export const MessageChannel = {
  Email: 'email',
} as const;
export type MessageChannel = (typeof MessageChannel)[keyof typeof MessageChannel];

/** Outbound mail transport selected via DI. */
export const MailDriver = {
  Postmark: 'postmark',
  Local: 'local',
} as const;
export type MailDriver = (typeof MailDriver)[keyof typeof MailDriver];

/** AI backend selected via DI. */
export const AiDriver = {
  /** Local model on spark (llama.cpp, OpenAI-compatible, no auth). */
  QwenLocal: 'qwen_local',
  /** Qwen on DashScope (cloud, OpenAI-compatible, API key). */
  QwenCloud: 'qwen_cloud',
} as const;
export type AiDriver = (typeof AiDriver)[keyof typeof AiDriver];

/** Usage-ledger row kinds (HP-15): one AI-call/token row, plus counted outreach/agent actions. */
export const UsageKind = {
  AiCall: 'ai_call',
  Embedding: 'embedding',
  EmailSent: 'email_sent',
  ReplyProcessed: 'reply_processed',
  DiscoveryCall: 'discovery_call',
  BackgroundResearch: 'background_research',
} as const;
export type UsageKind = (typeof UsageKind)[keyof typeof UsageKind];

/** Customer notification kinds (HP-13). */
export const NotificationKind = {
  ReportReady: 'report_ready',
  QuestionnaireReminder: 'questionnaire_reminder',
  Denial: 'denial',
} as const;
export type NotificationKind = (typeof NotificationKind)[keyof typeof NotificationKind];

/** Audit-trail entry categories (HP-14) — a read projection over existing sources. */
export const AuditEntryType = {
  Denial: 'denial',
  ComplianceBlock: 'compliance_block',
  AgentAction: 'agent_action',
  Transition: 'transition',
  OperatorAction: 'operator_action',
} as const;
export type AuditEntryType = (typeof AuditEntryType)[keyof typeof AuditEntryType];

/** Operator/system actions recorded in the audit log (HP-11/HP-12; feeds HP-14). */
export const AuditAction = {
  Cancel: 'cancel',
  Pause: 'pause',
  Resume: 'resume',
  PublishWorkflow: 'publish_workflow',
  Topup: 'topup', // admin manual credit top-up (HP-19)
  UnlockReport: 'unlock_report', // freemium report unlock charge (HP-21)
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

/** What an audit entry is about. */
export const AuditTargetType = {
  Inquiry: 'inquiry',
  Workflow: 'workflow',
  Customer: 'customer', // credit top-ups target a customer (HP-19)
} as const;
export type AuditTargetType = (typeof AuditTargetType)[keyof typeof AuditTargetType];

/**
 * Append-only credit ledger entry kinds. Balance =
 * Σ(topup) − Σ(reserve) + Σ(refund) − Σ(unlock); a `charge` finalizes a prior
 * reservation and has **no** further balance effect (credits were already held at
 * `reserve`); an `unlock` is a direct 1-credit debit for a freemium reveal (HP-21).
 */
export const CreditKind = {
  Topup: 'topup',     // admin grants credits
  Reserve: 'reserve', // held on inquiry submit (decrements available balance)
  Charge: 'charge',   // reservation finalized on REPORT_DELIVERED (no balance change)
  Refund: 'refund',   // reservation returned on denied/dropped/cancelled/failed
  Unlock: 'unlock',   // HP-21: direct 1-credit debit to unlock a freemium report
} as const;
export type CreditKind = (typeof CreditKind)[keyof typeof CreditKind];

/** Who a session belongs to. Admin is granted by the config allowlist (HP-10). */
export const AuthRole = {
  Customer: 'customer',
  Admin: 'admin',
} as const;
export type AuthRole = (typeof AuthRole)[keyof typeof AuthRole];

/** Which identity verifier backs Sign in with Google (real Google, or a dev/e2e stub). */
export const AuthVerifierDriver = {
  Google: 'google',
  Stub: 'stub',
} as const;
export type AuthVerifierDriver = (typeof AuthVerifierDriver)[keyof typeof AuthVerifierDriver];

/** Embeddings backend selected via DI (prior-report reuse vectors). */
export const EmbeddingsDriver = {
  /** OpenAI-compatible /embeddings endpoint (remote, API key). */
  OpenAI: 'openai',
  /** Deterministic in-process feature-hash embedding (offline default). */
  Local: 'local',
} as const;
export type EmbeddingsDriver = (typeof EmbeddingsDriver)[keyof typeof EmbeddingsDriver];

/**
 * Model-tier router. Breadth = cheap/fast (wide funnel, candidate discovery,
 * simple parsing). Depth = strong (per-subject-provider research, drafting &
 * replying in an email chain, verification reasoning, report synthesis).
 */
export const ModelTier = {
  Breadth: 'breadth',
  Depth: 'depth',
  Balanced: 'balanced',
} as const;
export type ModelTier = (typeof ModelTier)[keyof typeof ModelTier];

/** Pipeline stages — also the `AgentRun.stage` values. */
export const AgentStage = {
  PreResearch: 'pre_research',
  SendQuestionnaire: 'send_questionnaire',
  EnrichSubject: 'enrich_subject',
  BroadResearch: 'broad_research',
  BuildFunnel: 'build_funnel',
  StartOutreach: 'start_outreach',
  OutreachSubtask: 'outreach_subtask',
  GenerateReport: 'generate_report',
} as const;
export type AgentStage = (typeof AgentStage)[keyof typeof AgentStage];

/** pg-boss job names. Producers + consumers reference these (never a literal). */
export const QueueJob = {
  PreResearch: 'pre_research',
  SendQuestionnaire: 'send_questionnaire',
  EnrichSubject: 'enrich_subject',
  BroadResearch: 'broad_research',
  BuildFunnel: 'build_funnel',
  StartOutreach: 'start_outreach',
  OutreachSubtask: 'outreach_subtask',
  ResearchBackground: 'research_background',
  GenerateReport: 'generate_report',
  ProcessReply: 'process_reply',
  SubtaskSettled: 'subtask_settled',   // agentic reactor: react to a subtask qualifying/failing
  SendNotification: 'send_notification', // customer notifications (report-ready / denial) — HP-13
} as const;
export type QueueJob = (typeof QueueJob)[keyof typeof QueueJob];

/** Agent run status (`AgentRun.status`). */
export const AgentRunStatus = {
  Running: 'running',
  Done: 'done',
  Failed: 'failed',
  Stopped: 'stopped',
  /** Run abandoned because the inquiry was cancelled in-flight. */
  Cancelled: 'cancelled',
} as const;
export type AgentRunStatus = (typeof AgentRunStatus)[keyof typeof AgentRunStatus];

/**
 * Agent → orchestrator signal protocol. Agents emit these (via EventOutbox +
 * AgentEvent); the orchestrator/reaper consume them to drive `engine.advance`.
 */
export const AgentSignal = {
  Started: 'started',
  Progress: 'progress',
  Heartbeat: 'heartbeat',
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
  NeedsInput: 'needs_input',
} as const;
export type AgentSignal = (typeof AgentSignal)[keyof typeof AgentSignal];

/** Agent run activity-log entry kind (`AgentEvent.kind`). */
export const AgentEventKind = {
  Log: 'log',
  ToolCall: 'tool_call',
  Progress: 'progress',
  Error: 'error',
} as const;
export type AgentEventKind = (typeof AgentEventKind)[keyof typeof AgentEventKind];

/** Epic status (`Epic.status`). */
export const EpicStatus = {
  Open: 'open',
  Done: 'done',
  Stopped: 'stopped',
} as const;
export type EpicStatus = (typeof EpicStatus)[keyof typeof EpicStatus];

/** Workflow-definition lifecycle (`WorkflowDefinition.status`). */
export const WorkflowStatus = {
  Draft: 'draft',
  Active: 'active',
  Archived: 'archived',
} as const;
export type WorkflowStatus = (typeof WorkflowStatus)[keyof typeof WorkflowStatus];

/** Subject category (`Subject.category`). */
export const SubjectCategory = {
  Item: 'item',
  Service: 'service',
  Rental: 'rental',
  Organisation: 'organisation',
  Goods: 'goods',
  Trade: 'trade',
} as const;
export type SubjectCategory = (typeof SubjectCategory)[keyof typeof SubjectCategory];
