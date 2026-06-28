import { Injectable } from '@nestjs/common';
import { AiDriver, AuthVerifierDriver, ComplianceFailMode, EmbeddingsDriver, MailDriver, ModelTier } from '@inqi/shared';

/** A resolved connection profile for an OpenAI-compatible Qwen backend. */
export interface QwenProfile {
  apiKey?: string;
  baseUrl?: string;
  models: Record<ModelTier, string>;
}

const DASHSCOPE_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const SPARK_BASE_URL = 'http://192.168.1.45:8000/v1';

/**
 * Typed access to env/secrets. The one place bare `process.env` reads live, so
 * call sites depend on names + types, not string keys scattered through the code.
 */
@Injectable()
export class ConfigService {
  get port(): number {
    return Number(process.env.PORT ?? 4000);
  }

  get webOrigin(): string {
    return process.env.WEB_ORIGIN ?? '*';
  }

  get publicBaseUrl(): string {
    return process.env.PUBLIC_BASE_URL ?? 'http://localhost:4000';
  }

  /** Domain used to mint per-thread inbound reply addresses. */
  get inboundDomain(): string {
    return process.env.INBOUND_DOMAIN ?? 'reply.inqi.example';
  }

  get questionnaireTtlHours(): number {
    return Number(process.env.QUESTIONNAIRE_TTL_HOURS ?? 72);
  }

  /** When true, the pipeline fabricates inbound replies so it runs end-to-end without a mail provider. */
  get simulateReplies(): boolean {
    return (process.env.SIMULATE_REPLIES ?? 'false') === 'true';
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
  get resilience(): { leaseMs: number; reaperIntervalMs: number; maxAttempts: number } {
    return {
      leaseMs: Number(process.env.STAGE_LEASE_MS ?? 30_000),
      reaperIntervalMs: Number(process.env.REAPER_INTERVAL_MS ?? 10_000),
      maxAttempts: Number(process.env.STAGE_MAX_ATTEMPTS ?? 3),
    };
  }

  /**
   * Auth (HP-10). Google OAuth/OIDC client + the admin allowlist + the session
   * signing secret. All from env — never hard-coded.
   */
  get google(): { clientId?: string; clientSecret?: string; redirectUri?: string } {
    return {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    };
  }

  /** Which identity verifier to bind: real Google when a client id is set, else the dev/e2e stub. */
  get authVerifier(): AuthVerifierDriver {
    const explicit = process.env.AUTH_VERIFIER?.toLowerCase();
    if (explicit === AuthVerifierDriver.Google || explicit === AuthVerifierDriver.Stub) return explicit;
    return process.env.GOOGLE_CLIENT_ID ? AuthVerifierDriver.Google : AuthVerifierDriver.Stub;
  }

  /** Admin allowlist: explicit emails and/or an entire email domain (e.g. `monkeycode.io`). */
  get adminAllowlist(): { emails: string[]; domain?: string } {
    return {
      emails: (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean),
      domain: process.env.ADMIN_DOMAIN?.trim().toLowerCase() || undefined,
    };
  }

  /** Session JWT signing secret + lifetime. Dev default is clearly non-production. */
  get session(): { secret: string; ttlHours: number } {
    return {
      secret: process.env.SESSION_SECRET ?? 'dev-insecure-session-secret-change-me',
      ttlHours: Number(process.env.SESSION_TTL_HOURS ?? 24 * 7),
    };
  }

  get postmark(): { token?: string; fromAddress?: string } {
    return {
      token: process.env.POSTMARK_SERVER_TOKEN,
      fromAddress: process.env.POSTMARK_FROM,
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

  /**
   * HTTP Basic Auth credentials guarding the inbound webhook (Postmark secures
   * inbound parse by embedding credentials in the webhook URL). Unset → open (dev).
   */
  get webhookInboundAuth(): { user?: string; pass?: string } {
    return { user: process.env.WEBHOOK_INBOUND_USER, pass: process.env.WEBHOOK_INBOUND_PASS };
  }
}
