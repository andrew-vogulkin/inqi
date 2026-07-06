import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditAction, AuditTargetType } from '@inqi/shared';
import { PrismaService } from '../persistence/prisma.service';

export interface AuditEntry {
  actor: string;            // operator email, or 'system'
  action: AuditAction;
  targetType: AuditTargetType;
  targetId: string;
  reason?: string;
  data?: Record<string, unknown>;
}

/**
 * Durable audit sink for operator/system actions (HP-11 controls, HP-12 publishes).
 * Append-only; HP-14 builds the full audit trail on these rows. Realtime fan-out
 * (when relevant) is emitted separately via the EventOutbox at the call site.
 */
@Injectable()
export class AuditService {
  constructor(private readonly db: PrismaService) {}

  record({ actor, action, targetType, targetId, reason, data }: AuditEntry) {
    return this.db.auditLog.create({
      data: { actor, action, targetType, targetId, reason, data: (data ?? {}) as Prisma.InputJsonValue },
    });
  }
}
