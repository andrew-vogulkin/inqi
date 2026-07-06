import { InquiryStatus, MessageDirection, SourceType } from '@inqi/shared';

/**
 * Agent-context assembly: pack EVERYTHING the report knows (its inquiries, their
 * sources, their message threads) into one model-ready text block under a hard
 * token budget (default 100k; ~4 chars/token estimate). Pure + deterministic —
 * the service layer loads the rows, this packs them.
 *
 * Packing order:
 *   1. header (always): raw request, geo/budget/deadline, subject, confirmed answers
 *   2. one compact line per inquiry, best-first (focus > status rank > quality)
 *   3. detail rounds, round-robin across inquiries so none starves the rest:
 *      latest emails → rating/feedback snippets → websearch snippets → older messages
 */

export const AGENT_CONTEXT_BUDGET_TOKENS = 100_000;
const CHARS_PER_TOKEN = 4;
const BODY_TRUNCATE_CHARS = 1_500;

export const estTokens = (s: string): number => Math.ceil(s.length / CHARS_PER_TOKEN);

export interface ContextMessage {
  direction: string;
  body: string;
  createdAt: Date;
}

export interface ContextSource {
  type: string;
  url?: string | null;
  title?: string | null;
  snippet?: string | null;
  createdAt: Date;
}

export interface ContextInquiry {
  id: string;
  name: string;
  status: string;
  qualityScore?: number | null;
  result?: unknown;
  createdAt: Date;
  sources: ContextSource[];
  messages: ContextMessage[]; // newest first
}

export interface AgentContextInput {
  report: { rawRequest: string; geoLabel?: string | null; budgetMin?: number | null; budgetMax?: number | null; deadline?: Date | null };
  subject?: { title: string; description: string } | null;
  questionnaire?: { answers?: unknown; confirmed: boolean } | null;
  inquiries: ContextInquiry[];
  budgetTokens?: number;
  /** Put this inquiry first (the one the agent is currently working). */
  focusInquiryId?: string | null;
}

export interface AgentContext {
  text: string;
  estTokens: number;
  truncated: boolean;
}

const STATUS_RANK: Record<string, number> = {
  [InquiryStatus.Qualified]: 0,
  [InquiryStatus.Replied]: 1,
  [InquiryStatus.Contacted]: 2,
  [InquiryStatus.Researching]: 3,
  [InquiryStatus.Pending]: 4,
  [InquiryStatus.Failed]: 5,
  [InquiryStatus.Skipped]: 6,
};

const truncate = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max)}…[truncated]` : s);

function header({ report, subject, questionnaire }: AgentContextInput): string {
  const lines = [`# Customer request`, report.rawRequest];
  const facts: string[] = [];
  if (report.geoLabel) facts.push(`location: ${report.geoLabel}`);
  if (report.budgetMin != null || report.budgetMax != null) facts.push(`budget: ${report.budgetMin ?? '?'}–${report.budgetMax ?? '?'}`);
  if (report.deadline) facts.push(`deadline: ${report.deadline.toISOString().slice(0, 10)}`);
  if (facts.length) lines.push(facts.join(' | '));
  if (subject) lines.push(`# Subject`, `${subject.title} — ${subject.description}`);
  if (questionnaire?.confirmed && questionnaire.answers) lines.push(`# Confirmed scope`, JSON.stringify(questionnaire.answers));
  return lines.join('\n');
}

function inquiryLine(i: ContextInquiry): string {
  const bits = [`## ${i.name}`, `status=${i.status}`];
  if (i.qualityScore != null) bits.push(`quality=${i.qualityScore}`);
  if (i.result) bits.push(`result=${JSON.stringify(i.result)}`);
  return bits.join(' ');
}

/** One detail item per round per inquiry; rounds interleave so no inquiry starves the rest. */
function detailRounds(i: ContextInquiry): string[][] {
  const emails = i.messages.map((m) => `[${i.name}/${m.direction === MessageDirection.Outbound ? 'sent' : 'received'}] ${truncate(m.body, BODY_TRUNCATE_CHARS)}`);
  const ratings = i.sources.filter((s) => s.type === SourceType.RatingFeedback).slice(0, 3)
    .map((s) => `[${i.name}/rating] ${s.title ?? ''} ${s.snippet ?? ''}`.trim());
  const web = i.sources.filter((s) => s.type === SourceType.Websearch).slice(0, 3)
    .map((s) => `[${i.name}/web] ${s.title ?? s.url ?? ''}: ${s.snippet ?? ''}`.trim());
  // round 1: the freshest exchange (last inbound + last outbound); later rounds: ratings, web, older mail
  return [emails.slice(0, 2), ratings, web, emails.slice(2)];
}

/** Pack the full report picture into `budgetTokens`, best-signal-first. */
export function packAgentContext(input: AgentContextInput): AgentContext {
  const budget = input.budgetTokens ?? AGENT_CONTEXT_BUDGET_TOKENS;
  let used = 0;
  let truncated = false;
  const out: string[] = [];
  const push = (s: string): boolean => {
    const t = estTokens(s) + 1; // +1 for the joining newline
    if (used + t > budget) { truncated = true; return false; }
    out.push(s); used += t; return true;
  };

  push(header(input));

  const ordered = [...input.inquiries].sort((a, b) => {
    if (a.id === input.focusInquiryId) return -1;
    if (b.id === input.focusInquiryId) return 1;
    const r = (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9);
    if (r !== 0) return r;
    const q = (b.qualityScore ?? 0) - (a.qualityScore ?? 0);
    if (q !== 0) return q;
    return a.createdAt.getTime() - b.createdAt.getTime();
  });

  // Core pass: every inquiry gets its one-line summary before any detail spends budget.
  for (const i of ordered) {
    if (!push(inquiryLine(i))) return { text: out.join('\n'), estTokens: used, truncated };
  }

  // Detail rounds, round-robin over the ordered inquiries.
  const rounds = ordered.map(detailRounds);
  const maxRounds = Math.max(0, ...rounds.map((r) => r.length));
  for (let round = 0; round < maxRounds; round++) {
    for (let k = 0; k < ordered.length; k++) {
      for (const item of rounds[k][round] ?? []) {
        if (!item) continue;
        if (!push(item)) return { text: out.join('\n'), estTokens: used, truncated: true };
      }
    }
  }

  return { text: out.join('\n'), estTokens: used, truncated };
}
