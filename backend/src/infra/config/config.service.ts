import { Injectable } from '@nestjs/common';
import { AiDriver, ComplianceFailMode, EmbeddingsDriver, MailDriver, ModelTier, WebSearchDriver } from '@inqi/shared';

/** A resolved connection profile for an OpenAI-compatible Qwen backend. */
export interface QwenProfile {
  apiKey?: string;
  baseUrl?: string;
  models: Record<ModelTier, string>;
  /** Max concurrent requests to this backend; beyond it requests queue FIFO (local provider: 1). */
  maxConcurrency?: number;
}

const DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const SPARK_BASE_URL = 'http://192.168.1.45:8000/v1';

/** CORS allowlist when WEB_ORIGIN is unset: local Vite dev + the hosted frontend. */
const DEFAULT_WEB_ORIGINS = [
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173', // vite preview
  'https://inqi.monkeycode.io',
];

/** Cost price table (HP-15). All monetary values in `currency`; token prices are per 1,000 tokens. */
export interface PriceTable {
  currency: string;
  /** Per-model token prices; models not listed price at 0 (e.g. the local model). */
  models: Record<string, { promptPer1k: number; completionPer1k: number }>;
  perEmail: number;
  perEmbedding: number;
  perDiscoveryCall: number;
  perBackgroundResearch: number;
  perReplyProcessed: number;
  /** Per web-search call (each query the pipeline fires at the search provider). */
  perWebSearch: number;
}

/** Defaults — overridable wholesale via `PRICE_TABLE_JSON`. qwen_local (`qwen`) is free. */
const DEFAULT_PRICE_TABLE: PriceTable = {
  currency: 'USD',
  models: {
    qwen: { promptPer1k: 0, completionPer1k: 0 }, // local (spark) — no marginal cost
    'qwen-turbo': { promptPer1k: 0.0003, completionPer1k: 0.0006 },
    'qwen-plus': { promptPer1k: 0.0008, completionPer1k: 0.002 },
    'qwen-max': { promptPer1k: 0.0024, completionPer1k: 0.0096 },
    'text-embedding-v3': { promptPer1k: 0.00007, completionPer1k: 0 },
  },
  perEmail: 0.0015,        // Postmark cheapest plan ($15 / 10k emails) = $1.50 per 1k
  perEmbedding: 0,
  perDiscoveryCall: 0,
  perBackgroundResearch: 0,
  perReplyProcessed: 0,
  perWebSearch: 0.0005,    // self-hosted SearXNG amortized at $0.50 per 1k searches
};

/**
 * Typed access to env/secrets. The one place bare `process.env` reads live, so
 * call sites depend on names + types, not string keys scattered through the code.
 */
@Injectable()
export class ConfigService {
  get port(): number {
    return Number(process.env.PORT ?? 4000);
  }

  /**
   * Allowed CORS origins. `WEB_ORIGIN` overrides (comma-separated list, or `*` to
   * allow any); otherwise defaults to local dev + the hosted frontend. Auth uses
   * Bearer tokens (not cookies), so an allowlist is sufficient.
   */
  get webOrigins(): string[] | '*' {
    const raw = process.env.WEB_ORIGIN?.trim();
    if (raw === '*') return '*';
    if (raw) return raw.split(',').map((o) => o.trim()).filter(Boolean);
    return DEFAULT_WEB_ORIGINS;
  }

  get publicBaseUrl(): string {
    return process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000';
  }

  /** Domain used to mint per-thread inbound reply addresses. */
  get inboundDomain(): string {
    return process.env.INBOUND_DOMAIN ?? 'reply.inqi.example';
  }

  /**
   * HP-27: the intake address(es), comma-separated. An inbound email TO any of them
   * starts a brand-new report owned by the sender (no session, auto-created account).
   * Empty → the email-intake path is disabled. Matched case-insensitively on the full
   * address.
   *
   * A list, because intake must be RECEIVED by the inbound provider: the provider's own
   * inbound address works out of the box, and any address on the inbound MX domain works
   * too — while a mailbox on a domain whose MX belongs to someone else (e.g. Google) can
   * only reach us by forwarding.
   */
  get intakeAddresses(): string[] {
    return (process.env.INTAKE_ADDRESS ?? 'intake_inqi@monkeycode.io')
      .split(',')
      .map((a) => a.trim().toLowerCase())
      .filter(Boolean);
  }

  get questionnaireTtlHours(): number {
    return Number(process.env.QUESTIONNAIRE_TTL_HOURS ?? 72);
  }

  /**
   * Autopilot (HP-26): when true (default), pre-research auto-answers the scope
   * questionnaire from the request and runs straight through — the human is only
   * asked when the model itself flags a question it can't confidently infer.
   * Set AUTOPILOT_QUESTIONNAIRE=false to always require the customer to fill it.
   */
  get autopilotQuestionnaire(): boolean {
    return (process.env.AUTOPILOT_QUESTIONNAIRE ?? 'true') !== 'false';
  }

  /** When true, the pipeline fabricates inbound replies so it runs end-to-end without a mail provider. */
  get simulateReplies(): boolean {
    return (process.env.SIMULATE_REPLIES ?? 'false') === 'true';
  }

  /**
   * Fraction of simulated providers who never reply at all (0..1) — real outreach
   * is ignored sometimes, and this exercises the reply-timeout path end-to-end.
   * A silent provider stays silent: follow-ups to it are ignored too.
   */
  get simulateReplyIgnoreRate(): number {
    const rate = Number(process.env.SIMULATE_REPLY_IGNORE_RATE ?? 0);
    return Number.isFinite(rate) ? Math.min(1, Math.max(0, rate)) : 0;
  }

  /**
   * How many email rounds a simulated provider plays before giving the full quote
   * (1 = quote immediately). With 2+, earlier replies withhold the price and ask a
   * clarifying question — the agent must follow up, exercising multi-round threads.
   */
  get simulateReplyRounds(): number {
    const rounds = Number(process.env.SIMULATE_REPLY_ROUNDS ?? 1);
    return Number.isFinite(rounds) && rounds >= 1 ? Math.floor(rounds) : 1;
  }

  /** What the compliance gate does when the scorer is unavailable/errors (default: open). */
  get complianceFailMode(): ComplianceFailMode {
    return process.env.COMPLIANCE_FAIL_MODE?.toLowerCase() === ComplianceFailMode.Closed
      ? ComplianceFailMode.Closed
      : ComplianceFailMode.Open;
  }

  /**
   * Compliance risk band (inclusive) within which a BALANCED verdict is
   * "borderline" and gets re-scored at DEPTH. Outside the band the BALANCED
   * verdict stands (clearly safe / clearly blocked → no escalation cost).
   */
  get complianceBorderline(): { low: number; high: number } {
    return {
      low: Number(process.env.COMPLIANCE_BORDERLINE_LOW ?? 0.4),
      high: Number(process.env.COMPLIANCE_BORDERLINE_HIGH ?? 0.7),
    };
  }

  /** Which AI backend to bind to AI_PROVIDER. Explicit AI_DRIVER wins; defaults to cloud. */
  get aiDriver(): AiDriver {
    const explicit = process.env.AI_DRIVER?.toLowerCase();
    if (explicit === AiDriver.QwenLocal || explicit === AiDriver.QwenCloud) return explicit;
    return AiDriver.QwenCloud;
  }

  /** qwen_cloud: Qwen on DashScope (cloud, API key). */
  get qwenCloud(): QwenProfile {
    return {
      apiKey: process.env.QWEN_API_KEY,
      baseUrl: process.env.QWEN_BASE_URL ?? DASHSCOPE_BASE_URL,
      models: {
        [ModelTier.Breadth]: process.env.QWEN_MODEL_BREADTH ?? 'qwen-turbo',
        [ModelTier.Depth]: process.env.QWEN_MODEL_DEPTH ?? 'qwen-max',
        [ModelTier.Balanced]: process.env.QWEN_MODEL ?? 'qwen-plus',
      },
    };
  }

  /** qwen_local: the local model on spark (no auth, single model alias `qwen`). */
  get qwenLocal(): QwenProfile {
    const model = process.env.QWEN_LOCAL_MODEL ?? 'qwen';
    return {
      apiKey: process.env.QWEN_LOCAL_API_KEY ?? 'local',
      baseUrl: process.env.QWEN_LOCAL_BASE_URL ?? SPARK_BASE_URL,
      models: {
        [ModelTier.Breadth]: process.env.QWEN_LOCAL_MODEL_BREADTH ?? model,
        [ModelTier.Depth]: process.env.QWEN_LOCAL_MODEL_DEPTH ?? model,
        [ModelTier.Balanced]: model,
      },
      // One GPU, one honest FIFO: requests beyond this queue in arrival order.
      maxConcurrency: Number(process.env.LOCAL_AI_CONCURRENCY ?? 1),
    };
  }

  /**
   * Which embeddings backend to bind to EMBEDDINGS_PROVIDER. Explicit
   * EMBEDDINGS_DRIVER wins; otherwise `openai` when a real remote endpoint is
   * configured, else the deterministic local feature-hash embedding.
   */
  get embeddingsDriver(): EmbeddingsDriver {
    const explicit = process.env.EMBEDDINGS_DRIVER?.toLowerCase();
    if (explicit === EmbeddingsDriver.OpenAI || explicit === EmbeddingsDriver.Local) return explicit;
    const e = this.embeddings;
    return e.apiKey && e.baseUrl && !/^sk-x+$/i.test(e.apiKey) ? EmbeddingsDriver.OpenAI : EmbeddingsDriver.Local;
  }

  /** Embeddings backend (OpenAI-compatible /embeddings) connection profile. */
  get embeddings(): { apiKey?: string; baseUrl?: string; model: string; dim: number } {
    return {
      apiKey: process.env.EMBEDDINGS_API_KEY,
      baseUrl: process.env.EMBEDDINGS_BASE_URL,
      model: process.env.EMBEDDINGS_MODEL ?? 'text-embedding-v3',
      dim: Number(process.env.EMBEDDINGS_DIM ?? 1024),
    };
  }

  /** Prior-report reuse (pgvector similarity + PostGIS geo radius + freshness window). */
  get reuse(): { enabled: boolean; similarityThreshold: number; radiusMeters: number; freshnessDays: number } {
    return {
      enabled: (process.env.REUSE_ENABLED ?? 'true') === 'true',
      similarityThreshold: Number(process.env.REUSE_SIMILARITY_THRESHOLD ?? 0.15),
      radiusMeters: Number(process.env.REUSE_RADIUS_METERS ?? 50_000),
      freshnessDays: Number(process.env.REUSE_FRESHNESS_DAYS ?? 90),
    };
  }

  /**
   * Job resilience (HP-09): a running stage must finish or heartbeat within
   * `leaseMs`; the reaper sweeps every `reaperIntervalMs` and retries a stuck
   * stage up to `maxAttempts` times before dead-lettering it to a failure state.
   */
  get resilience(): { leaseMs: number; reaperIntervalMs: number; maxAttempts: number; replyTimeoutMinutes: number; outreachStallMs: number } {
    return {
      leaseMs: Number(process.env.STAGE_LEASE_MS ?? 30_000),
      reaperIntervalMs: Number(process.env.REAPER_INTERVAL_MS ?? 10_000),
      maxAttempts: Number(process.env.STAGE_MAX_ATTEMPTS ?? 3),
      // A contacted inquiry silent this long is marked UNRESPONSIVE by the reaper (not
      // failed — the thread stays open) so the report stops waiting on it.
      replyTimeoutMinutes: Number(process.env.REPLY_TIMEOUT_MINUTES ?? 240),
      // A report resting at OUTREACH this long with no research still in flight is
      // wedged (a lost/stale reactor kick) — the stalled-outreach sweep re-kicks it.
      outreachStallMs: Number(process.env.OUTREACH_STALL_MS ?? 120_000),
    };
  }

  /**
   * Two-step email sign-in MFA.
   * - `transport: 'mock'` (default) — every sign-in accepts the fixed `mockCode`;
   *   nothing is emailed. Keeps tests + local tooling deterministic.
   * - `transport: 'email'` (MFA_TRANSPORT=email) — a per-attempt random code is
   *   issued, emailed via MAIL_PROVIDER, and required on verify (the mock code no
   *   longer works). `codeTtlMs` bounds its lifetime. The sender is the `system`
   *   signature (see {@link postmark}) — codes are MailKind.System mail.
   */
  get mfa(): { transport: 'mock' | 'email'; mockCode: string; codeTtlMs: number } {
    return {
      transport: process.env.MFA_TRANSPORT?.toLowerCase() === 'email' ? 'email' : 'mock',
      mockCode: process.env.MFA_MOCK_CODE ?? '123456',
      codeTtlMs: Number(process.env.MFA_CODE_TTL_MS ?? 10 * 60_000),
    };
  }

  /**
   * Session JWT signing secret + lifetime. Tokens expire after `ttlHours` (8h
   * default); an active client prolongs its session before then via POST
   * /auth/refresh, which re-issues a fresh full-TTL token. Dev secret is
   * clearly non-production.
   */
  get session(): { secret: string; ttlHours: number } {
    return {
      secret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
      ttlHours: Number(process.env.SESSION_TTL_HOURS ?? 8),
    };
  }

  /**
   * Postmark transport. Two verified sender signatures, one per {@link MailKind}:
   * `systemFrom` for sign-in codes + customer mail, `outreachFrom` for the agent's
   * vendor outreach persona. Both must exist as sender signatures in Postmark.
   */
  get postmark(): { token?: string; systemFrom: string; outreachFrom: string } {
    return {
      token: process.env.POSTMARK_SERVER_TOKEN,
      systemFrom: process.env.POSTMARK_SYSTEM_FROM ?? 'system@monkeycode.io',
      outreachFrom: process.env.POSTMARK_FROM ?? 'marlowe.v@monkeycode.io',
    };
  }

  /**
   * Which mail transport to bind to MAIL_PROVIDER. Explicit `MAIL_DRIVER` wins;
   * otherwise use Postmark when a real token is set, else the local capture provider.
   */
  get mailDriver(): MailDriver {
    const explicit = process.env.MAIL_DRIVER?.toLowerCase();
    if (explicit === MailDriver.Postmark || explicit === MailDriver.Local) return explicit;
    const token = process.env.POSTMARK_SERVER_TOKEN;
    return token && !/^pm-x+$/i.test(token) ? MailDriver.Postmark : MailDriver.Local;
  }

  /** Directory the LocalMailProvider writes captured emails to. */
  get localMailDir(): string {
    return process.env.LOCAL_MAIL_DIR ?? '.mail-outbox';
  }

  /** Base URL for customer-facing webview links in notifications (HP-13). */
  get webBaseUrl(): string {
    return process.env.WEB_BASE_URL ?? this.publicBaseUrl;
  }

  /** Customer notifications (HP-13): how early to remind before questionnaire expiry + sweep cadence. */
  get notifications(): { reminderLeadHours: number; sweepIntervalMs: number } {
    return {
      reminderLeadHours: Number(process.env.REMINDER_LEAD_HOURS ?? 24),
      sweepIntervalMs: Number(process.env.REMINDER_SWEEP_INTERVAL_MS ?? 60_000),
    };
  }

  /** Audit retention seam (HP-14) — documented policy hook; no enforcement yet (ties to the PII story). */
  get auditRetentionDays(): number {
    return Number(process.env.AUDIT_RETENTION_DAYS ?? 365);
  }

  /**
   * Flat credit cost to run one report (HP-19). Reserved on submit, charged on
   * REPORT_DELIVERED, refunded on a non-delivered terminal. Seam to HP-15 for
   * usage-based ($→credits) pricing later; today it's a flat per-report cost.
   */
  get reportCostCredits(): number {
    return Math.max(0, Number(process.env.REPORT_COST_CREDITS ?? 1));
  }

  /**
   * Minimum credit balance an email-intake sender must already hold for their email to
   * start a report. Email intake is unauthenticated — anyone who knows the address can
   * spend our tokens — so the balance IS the authorization: only an existing customer who
   * can pay for the report gets one. Below this, the email is refused (and the freemium
   * free-report slot is never handed out over email).
   */
  get intakeMinCredits(): number {
    return Math.max(0, Number(process.env.INTAKE_MIN_CREDITS ?? 1));
  }

  /**
   * Cost price table (HP-15) — per-model $/1K tokens + per-action prices, single
   * currency. Configurable: `PRICE_TABLE_JSON` overrides the defaults wholesale.
   * `qwen_local` (alias `qwen`) is free; unknown models price at 0.
   */
  get prices(): PriceTable {
    const raw = process.env.PRICE_TABLE_JSON;
    if (raw) {
      // Merge over the defaults so an env table written before a price field existed
      // (e.g. perWebSearch) never yields undefined → NaN in the cost rollup.
      try {
        const parsed = JSON.parse(raw) as Partial<PriceTable>;
        return { ...DEFAULT_PRICE_TABLE, ...parsed, models: { ...DEFAULT_PRICE_TABLE.models, ...(parsed.models ?? {}) } };
      } catch { /* fall through to defaults */ }
    }
    return DEFAULT_PRICE_TABLE;
  }

  /**
   * HTTP Basic Auth credentials guarding the inbound webhook (Postmark secures
   * inbound parse by embedding credentials in the webhook URL). Unset → open (dev).
   */
  get webhookInboundAuth(): { user?: string; pass?: string } {
    return { user: process.env.WEBHOOK_INBOUND_USER, pass: process.env.WEBHOOK_INBOUND_PASS };
  }

  /** Which web-search backend to bind to WEB_SEARCH. Explicit WEBSEARCH_DRIVER wins; defaults to the self-hosted SearXNG. */
  get webSearchDriver(): WebSearchDriver {
    const explicit = process.env.WEBSEARCH_DRIVER?.toLowerCase();
    if (explicit === WebSearchDriver.Searxng || explicit === WebSearchDriver.Cloud) return explicit;
    return WebSearchDriver.Searxng;
  }

  /**
   * Web-search tool connection profile (SearXNG today). `baseUrl` is the instance
   * origin (the provider appends `/search?format=json`); results are capped to
   * `maxResults` and each request is bounded by `timeoutMs`.
   */
  get webSearch(): { baseUrl: string; timeoutMs: number; maxResults: number; requestIntervalMs: number; emptyRetryMs: number } {
    return {
      baseUrl: process.env.WEBSEARCH_BASE_URL ?? 'https://orange.tail035fe2.ts.net:8443',
      timeoutMs: Number(process.env.WEBSEARCH_TIMEOUT_MS ?? 10_000),
      maxResults: Number(process.env.WEBSEARCH_MAX_RESULTS ?? 8),
      // Global rate limit for outbound engine requests: the provider serialises every
      // search through one async queue that admits at most one request per
      // `requestIntervalMs` (default 1000 → 1 req/s across the whole process, all
      // reports). Protects the shared engines and keeps our egress a well-behaved
      // client. `emptyRetryMs` still retries once when a result set comes back empty
      // (that retry also takes a rate slot).
      requestIntervalMs: Number(process.env.WEBSEARCH_MIN_INTERVAL_MS ?? 1000),
      emptyRetryMs: Number(process.env.WEBSEARCH_EMPTY_RETRY_MS ?? 800),
    };
  }

  /**
   * Breadth/depth research limits (the report × inquiry × source matrix).
   * Breadth identifies at most `maxBreadthInquiries` candidates per report (funnel
   * hard cap — widening never exceeds it). Depth gathers at most
   * `maxSourcesPerInquiry` sources per inquiry, of which one slot is always
   * reserved for the email thread (so flat websearch/rating sources are capped at
   * `maxSourcesPerInquiry - 1`; email sources themselves are not capped).
   */
  get research(): { maxBreadthInquiries: number; maxSourcesPerInquiry: number; breadthMaxCycles: number; depthMaxToolCalls: number; depthCycles: number } {
    return {
      maxBreadthInquiries: Number(process.env.BREADTH_MAX_INQUIRIES ?? 8),
      maxSourcesPerInquiry: Number(process.env.SOURCES_MAX_PER_INQUIRY ?? 5),
      // Breadth-cycle HARD CAP: the discovery loop self-adjusts (cycles toward the
      // full target, stops on dry rounds / unchanged queries) — this only bounds it.
      breadthMaxCycles: Number(process.env.BREADTH_MAX_CYCLES ?? 50),
      // How many web_search / open_url calls one depth-agent CYCLE may spend.
      depthMaxToolCalls: Number(process.env.DEPTH_AGENT_MAX_TOOLCALLS ?? 6),
      // Depth-cycle HARD CAP per candidate: the evaluation gate drives actual usage
      // (sufficient evidence stops after cycle 1; repeated gaps stop as stalled) —
      // this only bounds a genuinely productive refine loop.
      depthCycles: Number(process.env.DEPTH_AGENT_CYCLES ?? 150),
    };
  }

  /** Headless-browser page reader (the depth agent's open_url tool). */
  get browser(): { pageTimeoutMs: number; pageMaxChars: number } {
    return {
      pageTimeoutMs: Number(process.env.BROWSER_PAGE_TIMEOUT_MS ?? 15_000),
      pageMaxChars: Number(process.env.BROWSER_PAGE_MAX_CHARS ?? 6_000),
    };
  }
}
