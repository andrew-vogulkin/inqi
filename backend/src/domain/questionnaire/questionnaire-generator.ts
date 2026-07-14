import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { ModelTier } from '@inqi/shared';
import { AI_PROVIDER, AiProvider, ToolSet } from '../../infra/ai/ai.tokens';
import { WEB_SEARCH, WebSearchProvider } from '../../infra/websearch/websearch.tokens';
import { questionnaireSystem, questionnaireAutofillSystem, questionnaireReplyParseSystem } from '../../infra/ai/prompts';
import { QuestionType, QuestionnaireQuestion } from './questionnaire.types';

const WEB_SEARCH_TOOL_NAME = 'web_search';
/** ~5 different searches + slack for a follow-up query. */
const TOOL_BUDGET = 7;
/** The agent researches until the schema is satisfied, up to this many runs. */
const MAX_ATTEMPTS = 3;

/** 7–10 select questions, each with 3–4 concrete options — the quality bar the agent must hit. */
const questionnaireSchema = z.object({
  questions: z.array(z.object({
    id: z.string().min(1).transform((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'q'),
    prompt: z.string().min(8),
    options: z.array(z.string().min(1)).min(3).max(4),
    /** true → the customer may pick several options (checkboxes); absent/false → single choice. */
    multi: z.boolean().catch(false),
  })).min(7).max(10),
});

/** Autopilot auto-answer output: an answer per question id, plus the "ask the human?" flag. */
const autofillSchema = z.object({
  answers: z.record(z.string()),
  needsHuman: z.boolean().catch(false),
  reason: z.string().optional(),
});

/** Email-reply parse output: the customer's prose mapped onto the questions + their confirm. */
const replyParseSchema = z.object({
  answers: z.record(z.string()),
  confirmedSubject: z.boolean().catch(true),
});

/** Appended to every option question: the customer can always delegate the choice to the agent. */
export const DECIDE_FOR_ME = 'Decide for me';

/** The always-appended final gate: the customer confirms the scope before outreach starts. */
const CONFIRM_QUESTION: QuestionnaireQuestion = { id: 'confirm', type: QuestionType.Confirm, prompt: 'Is this the right scope to start outreach?' };

/** Static fallback (AI unconfigured, or the agent never satisfied the schema). */
export const DEFAULT_QUESTIONS: QuestionnaireQuestion[] = [
  { id: 'confirm', prompt: 'Is this what you are looking for?', type: QuestionType.Confirm },
  { id: 'budget', prompt: 'Whats your budget range?', type: QuestionType.Text },
  { id: 'where', prompt: 'Preferred location / radius?', type: QuestionType.Text },
  { id: 'when', prompt: 'By when do you need it?', type: QuestionType.Text },
];

/**
 * The questionnaire research agent: framed as an expert in the subject, it runs
 * ~5 different web searches on the topic, then produces 7–10 select questions
 * with 3–4 concrete options each. It retries (fresh tool budget per attempt)
 * until the schema is satisfied; the static default only ships if every attempt
 * fails or AI is unconfigured.
 */
@Injectable()
export class QuestionnaireGenerator {
  private readonly logger = new Logger(QuestionnaireGenerator.name);

  constructor(
    @Inject(AI_PROVIDER) private readonly ai: AiProvider,
    @Inject(WEB_SEARCH) private readonly web: WebSearchProvider,
  ) {}

  async generate({ rawRequest, subject }: { rawRequest: string; subject?: { title: string; summary?: string } | null }): Promise<QuestionnaireQuestion[]> {
    if (!this.ai.isConfigured()) return DEFAULT_QUESTIONS;
    const expertise = subject?.title || rawRequest;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.ai.toolStructured({
          system: questionnaireSystem({ expertise }),
          user: JSON.stringify({ customerRequest: rawRequest, ...(subject ? { subject } : {}) }),
          tier: ModelTier.Balanced,
          tools: this.searchTools(),
          maxToolCalls: TOOL_BUDGET,
          validate: (raw) => questionnaireSchema.parse(raw),
          onToolCall: (c) => this.logger.log(`questionnaire[${expertise.slice(0, 32)}] a${attempt} tool ${c.name}(${JSON.stringify(c.args).slice(0, 100)})`),
        });
        const seen = new Set<string>();
        const questions: QuestionnaireQuestion[] = r.questions.map((q, i) => {
          const id = seen.has(q.id) ? `${q.id}_${i}` : q.id; // ids must be unique (answers are keyed by them)
          seen.add(id);
          // Every option question carries the "Decide for me" fallback — never generated, always appended.
          const options = [...q.options.filter((o) => o.trim().toLowerCase() !== DECIDE_FOR_ME.toLowerCase()), DECIDE_FOR_ME];
          return { id, prompt: q.prompt, type: q.multi ? QuestionType.MultiSelect : QuestionType.Select, options };
        });
        this.logger.log(`questionnaire generated on attempt ${attempt}: ${questions.length} questions`);
        return [...questions, CONFIRM_QUESTION];
      } catch (e) {
        this.logger.warn(`questionnaire attempt ${attempt}/${MAX_ATTEMPTS} failed (schema not satisfied yet): ${(e as Error).message}`);
      }
    }
    this.logger.warn('questionnaire agent exhausted attempts — shipping the static default');
    return DEFAULT_QUESTIONS;
  }

  /**
   * Autopilot (HP-26): answer the questionnaire on the customer's behalf, inferring
   * from their request. Returns the answer map (keyed by question id) plus a
   * `needsHuman` flag the model raises only for decisive questions it can't infer —
   * that flag is what makes the questionnaire "optional, asked only when necessary".
   * Fails safe: AI unconfigured → proceed with "Decide for me" defaults (never stall);
   * an inference error → defer to the human.
   */
  async autoAnswer({ rawRequest, subject, questions }: { rawRequest: string; subject?: { title: string; summary?: string } | null; questions: QuestionnaireQuestion[] }): Promise<{ answers: Record<string, string>; needsHuman: boolean; reason?: string }> {
    // Only the option/text questions carry answers; the trailing Confirm gate is the `confirmed` column.
    const answerable = questions.filter((q) => q.type !== QuestionType.Confirm);
    if (answerable.length === 0) return { answers: {}, needsHuman: false, reason: 'no questions to answer' };
    if (!this.ai.isConfigured()) {
      return { answers: Object.fromEntries(answerable.map((q) => [q.id, DECIDE_FOR_ME])), needsHuman: false, reason: 'ai-unconfigured-default' };
    }
    try {
      const r = await this.ai.structured({
        system: questionnaireAutofillSystem(),
        user: JSON.stringify({
          customerRequest: rawRequest,
          ...(subject ? { subject } : {}),
          questions: answerable.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options ?? [], multi: q.type === QuestionType.MultiSelect })),
        }),
        tier: ModelTier.Balanced,
        validate: (raw) => autofillSchema.parse(raw),
      });
      // Keep only known ids; any question the model skipped falls back to "Decide for me".
      const answers: Record<string, string> = {};
      for (const q of answerable) answers[q.id] = (r.answers[q.id] ?? '').trim() || DECIDE_FOR_ME;
      this.logger.log(`questionnaire auto-answered (${answerable.length} q, needsHuman=${r.needsHuman}): ${r.reason ?? ''}`);
      return { answers, needsHuman: !!r.needsHuman, reason: r.reason };
    } catch (e) {
      this.logger.warn(`autopilot auto-answer failed — deferring to the customer: ${(e as Error).message}`);
      return { answers: {}, needsHuman: true, reason: 'inference-failed' };
    }
  }

  /**
   * HP-27: parse a customer's free-text EMAIL reply to the questionnaire into the
   * structured answer map + their confirm. Fails safe: no AI / parse error →
   * every question defaults to "Decide for me" and confirmedSubject=true, so an
   * email report never stalls on an unparseable reply.
   */
  async parseReply({ questions, replyBody }: { questions: QuestionnaireQuestion[]; replyBody: string }): Promise<{ answers: Record<string, string>; confirmedSubject: boolean }> {
    const answerable = questions.filter((q) => q.type !== QuestionType.Confirm);
    const safeDefault = () => ({ answers: Object.fromEntries(answerable.map((q) => [q.id, DECIDE_FOR_ME])), confirmedSubject: true });
    if (!this.ai.isConfigured() || answerable.length === 0) return safeDefault();
    try {
      const r = await this.ai.structured({
        system: questionnaireReplyParseSystem(),
        user: JSON.stringify({
          reply: replyBody,
          questions: answerable.map((q) => ({ id: q.id, prompt: q.prompt, options: q.options ?? [], multi: q.type === QuestionType.MultiSelect })),
        }),
        tier: ModelTier.Balanced,
        validate: (raw) => replyParseSchema.parse(raw),
      });
      const answers: Record<string, string> = {};
      for (const q of answerable) answers[q.id] = (r.answers[q.id] ?? '').trim() || DECIDE_FOR_ME;
      return { answers, confirmedSubject: r.confirmedSubject };
    } catch (e) {
      this.logger.warn(`questionnaire email reply parse failed — defaulting to Decide-for-me: ${(e as Error).message}`);
      return safeDefault();
    }
  }

  /** web_search only — the questionnaire agent surveys the topic, it doesn't deep-read pages. */
  private searchTools(): ToolSet {
    const def = this.web.tools.find((t) => (t as { function?: { name?: string } }).function?.name === WEB_SEARCH_TOOL_NAME);
    return {
      definitions: def ? [def] : [],
      execute: ({ name, args }) => this.web.executeTool({ name, args }), // returns error JSON on failure
    };
  }
}
