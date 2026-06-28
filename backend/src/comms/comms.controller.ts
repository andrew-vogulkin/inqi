import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CommsService } from './comms.service';

@Controller('comms')
export class CommsController {
  constructor(private db: PrismaService, private comms: CommsService) {}

  /** Inbound email webhook (subject provider -> inqi). Map by To address, thread, queue reply loop. */
  @Post('inbound')
  inbound(@Body() b: any) {
    return this.comms.ingestInbound({
      toAddr: b.to ?? b.toAddr, fromAddr: b.from ?? b.fromAddr, subject: b.subject,
      body: b.text ?? b.body ?? '', externalId: b.messageId ?? b.externalId,
      inReplyTo: b.inReplyTo, references: b.references,
    });
  }

  /** Full email thread for a subtask (admin / report timeline). */
  @Get('thread/:subtaskId')
  thread(@Param('subtaskId') id: string) {
    return this.db.inquiryMessage.findMany({ where: { subtaskId: id }, orderBy: { createdAt: 'asc' } });
  }
}
