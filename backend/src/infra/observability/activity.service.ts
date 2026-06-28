import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AgentEventKind, AgentRunStatus, AgentStage, EventType } from '@inqi/shared';
import { PrismaService } from '../persistence/prisma.service';
import { OutboxService } from '../events/outbox.service';
import { ConfigService } from '../config/config.service';

/** Progress logger handed to a staged run; persists an AgentEvent + emits progress. */
export type StageLogger = (args: { message: string; data?: Record<string, unknown> }) => Promise<void>;

/**
 * Observability + liveness: wraps a pipeline stage in an AgentRun lifecycle
 * (running → done/failed), records AgentEvents, and emits agent.started/progress/
 * heartbeat/stopped/failed through the durable outbox. The run carries a lease
 * (`leaseUntil`) that each heartbeat extends; if a stage dies without finishing,
 * the lease expires and the reaper recovers it — no job goes stale (HP-09).
 */
@Injectable()
export class ActivityService {
  constructor(
    private readonly db: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  private leaseFromNow(): Date {
    return new Date(Date.now() + this.config.resilience.leaseMs);
  }

  async runStage({ inquiryId, stage, fn }: { inquiryId: string; stage: AgentStage; fn: (log: StageLogger) => Promise<void> }): Promise<void> {
    const now = new Date();
    const run = await this.db.agentRun.create({ data: { inquiryId, stage, leaseUntil: this.leaseFromNow(), heartbeatAt: now } });
    // Heartbeat on every progress log: persist the event, extend the lease, emit progress + heartbeat.
    const log: StageLogger = async ({ message, data }) => {
      await this.db.agentEvent.create({ data: { runId: run.id, kind: AgentEventKind.Progress, message, data: data as Prisma.InputJsonValue } });
      await this.db.agentRun.update({ where: { id: run.id }, data: { heartbeatAt: new Date(), leaseUntil: this.leaseFromNow() } });
      await this.outbox.emit({ type: EventType.AgentProgress, inquiryId, data: { stage, message } });
      await this.outbox.emit({ type: EventType.AgentHeartbeat, inquiryId, data: { stage } });
    };

    await this.outbox.emit({ type: EventType.AgentStarted, inquiryId, data: { stage } });
    try {
      await fn(log);
      await this.db.agentRun.update({ where: { id: run.id }, data: { status: AgentRunStatus.Done, endedAt: new Date(), leaseUntil: null } });
      await this.outbox.emit({ type: EventType.AgentStopped, inquiryId, data: { stage, status: AgentRunStatus.Done } });
    } catch (e) {
      const error = String((e as Error)?.message ?? e);
      // Clear the lease so the reaper doesn't also pick it up — this inline failure is handled by the worker's recoverStage.
      await this.db.agentRun.update({ where: { id: run.id }, data: { status: AgentRunStatus.Failed, error, endedAt: new Date(), leaseUntil: null } });
      await this.outbox.emit({ type: EventType.AgentFailed, inquiryId, data: { stage, error } });
      throw e;
    }
  }
}
