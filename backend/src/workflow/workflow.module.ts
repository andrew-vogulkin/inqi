import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { WorkflowEngine } from './engine.service';

@Global()
@Module({ providers: [PrismaService, BossService, OutboxService, WorkflowEngine], exports: [WorkflowEngine] })
export class WorkflowModule {}
