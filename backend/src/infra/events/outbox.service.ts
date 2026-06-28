import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventType } from '@inqi/shared';
import { PrismaService } from '../persistence/prisma.service';

export interface EmitArgs {
  type: EventType;
  inquiryId: string;
  epicId?: string;
  subtaskId?: string;
  data?: Record<string, unknown>;
}

/**
 * Durable event outbox. Every realtime signal is written here first (durable +
 * replayable); a Postgres trigger NOTIFYs and the gateway fans out. Nothing is
 * ever emitted straight to sockets.
 */
@Injectable()
export class OutboxService {
  constructor(private readonly db: PrismaService) {}

  emit({ type, inquiryId, epicId, subtaskId, data }: EmitArgs) {
    return this.db.eventOutbox.create({
      data: { type, inquiryId, epicId, subtaskId, data: (data ?? {}) as Prisma.InputJsonValue },
    });
  }
}
