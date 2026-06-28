import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { QuestionnaireModule } from '../questionnaire/questionnaire.module';
import { AgentsService } from './agents.service';

@Module({ imports: [QuestionnaireModule], providers: [PrismaService, BossService, OutboxService, AgentsService] })
export class AgentsModule {}
