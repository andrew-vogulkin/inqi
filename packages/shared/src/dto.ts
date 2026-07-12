import type { OutreachStrategy } from './workflow.js';
import type { AuthRole, MessageDirection, MessageStatus, SearchFocus, SourceType } from './enums.js';

export interface CreateReportDto {
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
  /** Ranking priority: what depth research should hunt hardest for (default: quality). */
  focus?: SearchFocus;
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

/** Auth (POST /auth/email + /auth/email/verify → session; GET /auth/me). */
export interface SessionDto {
  token: string;
  customer: { id: string; email: string; name?: string | null; role: AuthRole };
}

/** A single report row (GET /reports, owner-scoped) — the root customer request. */
export interface ReportDto {
  id: string;
  /** Human-facing reference (RPT-YYMMDD-NN); null only on legacy/seed rows. */
  ref?: string | null;
  rawRequest: string;
  state: string;
  stage?: string;            // HP-23: derived ReportStage (from state + qualifiedCount)
  qualifiedCount?: number;   // HP-23: inquiries qualified so far (drives the stage)
  personaId?: string | null; // the persona carrying all interaction for this report
  focus?: SearchFocus | null; // ranking priority (price | quality)
  customerEmail: string;
  customerId?: string | null;
  createdAt: string;
}

/**
 * One page of the admin report search (GET /admin/reports) — the operator report
 * picker. Rows are newest-first; `q` matched the ref / customer email / request text.
 */
export interface ReportSearchResultDto {
  rows: ReportDto[];
  /** Pass back as `cursor` to fetch the next (older) page; null = no more rows. */
  nextCursor: string | null;
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
  inquiryId?: string; // admin-side report: lets the dossier fetch the chain
}

/** Live-assembled report while the pipeline runs (GET /reports/:id/live). */
export interface LiveReportDto {
  reportId: string;
  /** Human-facing reference (RPT-YYMMDD-NN); null only on legacy/seed rows. */
  ref?: string | null;
  personaId?: string | null; // the persona who ran/runs this research (1:1 per report)
  state: string;
  stage?: string;            // HP-23: derived ReportStage
  qualifiedCount?: number;   // HP-23: inquiries qualified so far
  questionnaireToken?: string | null; // capability token while in the Questionnaire stage
  questionnaire?: { questions: QuestionnaireQuestion[]; answers: Record<string, string> | null; confirmed: boolean } | null; // read-only scope shown on the report
  delivered: boolean;
  rawRequest: string;
  focus?: SearchFocus | null; // ranking priority the customer picked (price | quality)
  snapshotId?: string | null;  // HP-21: the snapshot id (for POST /snapshots/:id/unlock)
  snapshotToken: string | null;
  reusedFrom: string | null;
  summary: string;
  options: ReportOption[];
  freemium?: boolean;        // HP-21: free + locked → top options redacted until unlocked
  unlocked?: boolean;        // HP-21: revealed after a 1-credit unlock
  lockedCount?: number;      // HP-21: how many options are withheld (locked stubs)
  /** Providers contacted/vetted that did NOT qualify (failed | unresponsive) — an
   *  empty options list should show what was tried, not a bare empty state. */
  failedInquiries?: { name: string; status: string }[];
}

/** Final report snapshot by capability token (GET /snapshots/:token, public deep link). */
export interface ReportSnapshotDto {
  id: string;
  reportId: string;
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

/** Result of a freemium unlock (POST /snapshots/:id/unlock; HP-21). */
export interface UnlockResultDto { id: string; unlocked: boolean; balance: number }

/** Customer credits (GET /me/credits). */
export interface CreditEntry {
  id: string;
  kind: string;
  amount: number;
  reason?: string | null;
  actor?: string | null;
  reportId?: string | null;
  createdAt: string;
}
export interface CreditsDto { balance: number; history: CreditEntry[] }

/** Questionnaire (GET /q/:token, capability token). */
export interface QuestionnaireQuestion { id: string; type: string; prompt: string; options?: string[] }
export interface QuestionnaireDto {
  id: string;
  reportId: string;
  token: string;
  questions: QuestionnaireQuestion[];
  answers?: Record<string, string> | null;
  confirmed: boolean;
  expiresAt: string;
}

/** Per-report cost rollup (GET /reports/:id/cost, admin; HP-15). */
export interface CostSummaryDto {
  currency: string;
  perModel: { model: string; promptTokens: number; completionTokens: number; estUsd: number }[];
  outreach: { emails: number; replies: number; discovery: number; research: number; embeddings: number; estUsd: number };
  /** Every web search the pipeline fired for this report, with the serving provider. */
  webSearch: { calls: number; provider: string; estUsd: number };
  tokenTotal: number;
  grandTotalUsd: number;
}

/** One channel source record under an inquiry (Source rows). */
export interface SourceDto {
  id: string;
  inquiryId: string;
  type: SourceType;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  createdAt: string;
}

/** One message in an inquiry thread (GET /comms/thread/:inquiryId → array; admin). */
export interface ThreadMessageDto {
  id: string;
  inquiryId: string;
  sourceId?: string | null; // the thread-channel source (email/whatsapp) carrying this message
  direction: MessageDirection;
  status: MessageStatus;
  fromAddr?: string | null;
  toAddr?: string | null;
  subject?: string | null;
  body: string;
  createdAt: string;
}

/** Admin board — nested report detail (GET /reports/:id, admin scope). */
export interface BoardInquiryDto {
  id: string;
  epicId: string;
  name: string;
  wave: number;
  status: string;
  qualityScore?: number | null;
  result?: unknown;
  /** True while a depth-research job is still queued/running for this inquiry (background/sources incomplete). */
  researchPending?: boolean;
  /** The inquiry's channel-source matrix (websearch / rating_feedback / email rows). */
  sources?: SourceDto[];
}
export interface BoardEpicDto {
  id: string;
  strategy: string;
  status: string;
  targetQualifiedOptions: number;
  releasedWaves?: number[];
  inquiries: BoardInquiryDto[];
}
export interface ReportBoardDto {
  id: string;
  rawRequest: string;
  state: string;
  personaId?: string | null;
  customerEmail: string;
  subject?: { title?: string; description?: string } | null;
  questionnaire?: { confirmed: boolean; questions?: QuestionnaireQuestion[]; answers?: Record<string, string> | null } | null;
  epics: BoardEpicDto[];
}

/** Audit trail (GET /audit → AuditResultDto; admin; HP-14). */
export interface AuditEntryDto {
  type: string;
  at: string;
  actor: string;
  reason?: string;
  reportId?: string;
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
  pinnedReports: number;
  createdAt?: string;
}
export interface GraphStateDto {
  name: string;
  isInitial: boolean;
  isTerminal: boolean;
  /** Operator binding (subject_build states may alias an operator id). */
  handler?: string | null;
  /** Per-state params: stage-1 tunable genes (poolCap, dryRoundsToStop, …) and subject_build layer/predicate. */
  config?: Record<string, unknown> | null;
}
export interface GraphTransitionDto { fromState: string; toState: string; event: string }
export interface WorkflowInspectDto {
  id: string;
  key: string;
  version: number;
  status: string;
  states: GraphStateDto[];
  transitions: GraphTransitionDto[];
  validation: { valid: boolean; errors: string[] };
  /** The phase's tunable-gene registry (empty for non-evolving keys). */
  tunables?: { key: string; state: string; min: number; max: number; fallback: number | null; describe: string }[];
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

/** One message of the outreach conversation, as shown to the customer (no addresses/ids). */
export interface ProvenanceChainMessage {
  direction: string;
  subject: string | null;
  body: string;
  at: string;
  /** Thread channel label when the provider has several contacts (sales, booking, …). */
  channel?: string | null;
}

/**
 * Customer provenance for one option (HP-20). Sourced from findings + the
 * inquiry's sources/background. The outreach block carries the **full email
 * chain** (direction + body + timestamp) — the customer sees the conversation
 * as it happened; only relay addresses/message ids stay internal.
 */
export interface ProvenanceDto {
  web: { source: string; url: string; snippet: string }[];
  feedback: { rating: number; sentiment: number; themes: string[]; quotes: string[] };
  scoring: { feedbackScore: number; priceScore: number; blendedScore: number; rank: number };
  outreach: { persona: string; route: string; outcome: OutreachOutcome; chain: ProvenanceChainMessage[] };
  depth: ProvenanceDepth;
  /** True while the inquiry's depth research is still queued/running — sections below may still fill in. */
  researchPending?: boolean;
  /** False when this dossier belongs to a contacted/vetted provider that did NOT qualify (unranked; scoring.rank = 0). */
  qualified?: boolean;
  /** The vet verdict's reason when `qualified` is false (customer-safe text from the research verdict). */
  disqualifyReason?: string | null;
  /** AI transparency summaries — how inqi evaluated this option, per section + an overall ranking rationale. */
  summaries?: ProvenanceSummaries;
  /**
   * How the customer can carry this option forward themselves: the provider's
   * website/socials (from discovery) and their email address when real outbound
   * mail recorded one (empty in the simulated local driver).
   */
  reference?: ProvenanceReference;
}

export interface ProvenanceReference {
  website: string | null;
  socials: string[];
  contactEmail: string | null;
}
/**
 * AI transparency summaries per dossier section, plus `overview` — the general
 * summary rendered above the sections, citing them inline as [1]=web search,
 * [2]=outreach, [3]=feedback scan, [4]=qualification & ranking. Optional for
 * cache back-compat: entries stored before the field existed lack it.
 */
export interface ProvenanceSummaries { overview?: string; web: string; outreach: string; feedback: string; ranking: string }
