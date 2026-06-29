import type { OutreachStrategy } from './workflow.js';
import type { AuthRole, MessageDirection, MessageStatus } from './enums.js';

export interface CreateInquiryDto {
  /**
   * @deprecated HP-19: intake is authenticated; the owner is the signed-in customer
   * (from the session), so the server ignores this and uses the verified email.
   */
  customerEmail?: string;
  /** Free-text of what they're looking for (item/service/rental/org/goods/trade). */
  rawRequest: string;
  geo?: { lat: number; lng: number; label?: string };
  budgetMin?: number;
  budgetMax?: number;
  deadline?: string; // ISO
}

export interface QuestionnaireAnswersDto {
  confirmedSubject: boolean;       // customer confirms the item/service is correct
  answers: Record<string, string>;
}

export interface EpicConfig {
  strategy: OutreachStrategy;
  targetQualifiedOptions: number;  // stop early once reached
}

// ---------------------------------------------------------------------------
// Response DTOs (API-03) — the wire shapes the api layer returns. JSON-serialized,
// so dates are ISO strings. Naming keeps the codebase's `...Dto` suffix.
// ---------------------------------------------------------------------------

/** Auth (POST /auth/google → session; GET /auth/me). */
export interface SessionDto {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

/** A single inquiry row (GET /inquiries, owner-scoped). */
export interface InquiryDto {
  id: string;
  rawRequest: string;
  state: string;
  customerEmail: string;
  customerId?: string | null;
  createdAt: string;
}

/** A ranked report option. A freemium-locked row carries ONLY id/locked/rank. */
export interface ReportOption {
  subjectProvider: string;
  price?: number | null;
  currency?: string | null;
  score?: number;
  qualityScore?: number;
  availability?: string;
  leadTime?: string;
  background?: unknown;
  id?: string;
  locked?: boolean;
  rank?: number;
  subtaskId?: string; // admin-side report: lets the dossier fetch the chain
}

/** Live-assembled report while the pipeline runs (GET /inquiries/:id/report-live, public). */
export interface LiveReportDto {
  inquiryId: string;
  state: string;
  delivered: boolean;
  rawRequest: string;
  reportId?: string | null;  // HP-21: the snapshot id (for POST /reports/:id/unlock)
  reportToken: string | null;
  reusedFrom: string | null;
  summary: string;
  options: ReportOption[];
  freemium?: boolean;        // HP-21: free + locked → top options redacted until unlocked
  unlocked?: boolean;        // HP-21: revealed after a 1-credit unlock
  lockedCount?: number;      // HP-21: how many options are withheld (locked stubs)
}

/** Final report by capability token (GET /reports/:token, public deep link). */
export interface ReportDto {
  id: string;
  inquiryId: string;
  token: string;
  summary: string;
  options: ReportOption[];
  timeline: unknown;
  reusedFrom?: string | null;
  freemium?: boolean;   // HP-21
  unlocked?: boolean;   // HP-21
  lockedCount?: number; // HP-21
  createdAt: string;
}

/** Result of a freemium unlock (POST /reports/:id/unlock; HP-21). */
export interface UnlockResultDto { id: string; unlocked: boolean; balance: number }

/** Customer credits (GET /me/credits). */
export interface CreditEntry {
  id: string;
  kind: string;
  amount: number;
  reason?: string | null;
  actor?: string | null;
  inquiryId?: string | null;
  createdAt: string;
}
export interface CreditsDto { balance: number; history: CreditEntry[] }

/** Questionnaire (GET /q/:token, capability token). */
export interface QuestionnaireQuestion { id: string; type: string; prompt: string; options?: string[] }
export interface QuestionnaireDto {
  id: string;
  inquiryId: string;
  token: string;
  questions: QuestionnaireQuestion[];
  answers?: Record<string, string> | null;
  confirmed: boolean;
  expiresAt: string;
}

/** Per-inquiry cost rollup (GET /inquiries/:id/cost, admin; HP-15). */
export interface CostSummaryDto {
  currency: string;
  perModel: { model: string; promptTokens: number; completionTokens: number; estUsd: number }[];
  outreach: { emails: number; replies: number; discovery: number; research: number; embeddings: number; estUsd: number };
  tokenTotal: number;
  grandTotalUsd: number;
}

/** One email message in a subtask thread (GET /comms/thread/:subtaskId → array; admin). */
export interface ThreadMessageDto {
  id: string;
  subtaskId: string;
  direction: MessageDirection;
  status: MessageStatus;
  fromAddr?: string | null;
  toAddr?: string | null;
  subject?: string | null;
  body: string;
  createdAt: string;
}

/** Admin board — nested inquiry detail (GET /inquiries/:id, admin scope). */
export interface BoardSubtaskDto {
  id: string;
  epicId: string;
  subjectProviderName: string;
  wave: number;
  status: string;
  qualityScore?: number | null;
  personaId?: string | null;
  result?: unknown;
}
export interface BoardEpicDto {
  id: string;
  strategy: string;
  status: string;
  targetQualifiedOptions: number;
  releasedWaves?: number[];
  subtasks: BoardSubtaskDto[];
}
export interface InquiryBoardDto {
  id: string;
  rawRequest: string;
  state: string;
  customerEmail: string;
  subject?: { title?: string; description?: string } | null;
  questionnaire?: { confirmed: boolean; answers?: Record<string, string> | null } | null;
  epics: BoardEpicDto[];
}

/** Audit trail (GET /audit → AuditResultDto; admin; HP-14). */
export interface AuditEntryDto {
  type: string;
  at: string;
  actor: string;
  reason?: string;
  inquiryId?: string;
  refs?: Record<string, unknown>;
  data?: Record<string, unknown>;
}
export interface AuditResultDto { total: number; entries: AuditEntryDto[] }

/** Workflow versions (GET /workflows; HP-12). */
export interface WorkflowVersionDto {
  id: string;
  key: string;
  version: number;
  status: string;
  pinnedInquiries: number;
  createdAt?: string;
}
export interface GraphStateDto { name: string; isInitial: boolean; isTerminal: boolean }
export interface GraphTransitionDto { fromState: string; toState: string; event: string }
export interface WorkflowInspectDto {
  id: string;
  key: string;
  version: number;
  status: string;
  states: GraphStateDto[];
  transitions: GraphTransitionDto[];
  validation: { valid: boolean; errors: string[] };
}
/** The inner add/remove sets (states + transitions). No `changed` — derived on the FE. */
export interface VersionDiffDto {
  states: { added: string[]; removed: string[] };
  transitions: { added: string[]; removed: string[] };
}
export interface VersionDiffResultDto {
  from: { id: string; version: number } | null;
  to: { id: string; version: number };
  diff: VersionDiffDto;
}
export interface PublishResultDto { id: string; version: number; status: string; alreadyActive: boolean }

/** Admin customer directory/search (GET /admin/customers?q=; HP-22). */
export interface CustomerDirectoryDto { id: string; name: string; email: string }

/** Research depth for an option's provenance (HP-20). */
export const ProvenanceDepth = {
  WebOnly: 'WebOnly',
  WebFeedback: 'WebFeedback',
  WebOutreachFeedback: 'WebOutreachFeedback',
} as const;
export type ProvenanceDepth = (typeof ProvenanceDepth)[keyof typeof ProvenanceDepth];

/** Redacted outreach outcome for the customer provenance (no chain/addresses). */
export const OutreachOutcome = {
  Replied: 'replied',
  Pending: 'pending',
  NotContacted: 'not_contacted',
} as const;
export type OutreachOutcome = (typeof OutreachOutcome)[keyof typeof OutreachOutcome];

/**
 * Customer-safe provenance for one option (HP-20). Sourced from findings + the
 * subject-provider background; the outreach block is **redacted** (no email chain,
 * addresses, bodies, or message ids — those stay on the admin `/comms/thread`).
 */
export interface ProvenanceDto {
  web: { source: string; url: string; snippet: string }[];
  feedback: { rating: number; sentiment: number; themes: string[]; quotes: string[] };
  scoring: { feedbackScore: number; priceScore: number; blendedScore: number; rank: number };
  outreach: { persona: string; route: string; outcome: OutreachOutcome };
  depth: ProvenanceDepth;
}
