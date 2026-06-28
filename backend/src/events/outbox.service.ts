import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Write to the durable outbox; the DB trigger NOTIFYs and the gateway fans out. */
@Injectable()
export class OutboxService {
  constructor(private db: PrismaService) {}
  emit(type: string, p: { inquiryId: string; epicId?: string; subtaskId?: string; data?: any }) {
    return this.db.eventOutbox.create({
      data: { type, inquiryId: p.inquiryId, epicId: p.epicId, subtaskId: p.subtaskId, data: p.data ?? {} },
    });
  }
}
