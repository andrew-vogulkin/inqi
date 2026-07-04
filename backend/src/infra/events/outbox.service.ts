import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventType } from '@inqi/shared';
import { DbTx, PrismaService } from '../persistence/prisma.service';

export interface EmitArgs {
  type: EventType;
  reportId: string;
  epicId?: string;
  inquiryId?: string;
  data?: Record<string, unknown>;
  /** When a service opens a transaction, pass its executor so the event commits atomically with the writes that produced it. */
  tx?: DbTx;
}

/**
 * Durable event outbox. Every realtime signal is written here first (durable +
 * replayable); a Postgres trigger NOTIFYs and the gateway fans out. Nothing is
 * ever emitted straight to sockets. When a `tx` is passed the row joins that
 * transaction — the NOTIFY only fires on commit, so consumers never see an event
 * for a write that rolled back.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: PrismaService) {}

  emit({ type, reportId, epicId, inquiryId, data, tx }: EmitArgs) {
    return (tx ?? this.db).eventOutbox.create({
      data: { type, reportId, epicId, inquiryId, data: (data ?? {}) as Prisma.InputJsonValue },
    });
  }
}
