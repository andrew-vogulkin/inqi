import { Module } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { BossService } from './queue/boss.service';
import { AiModule } from './ai/ai.module';
import { EventsModule } from './events/events.module';
import { WorkflowModule } from './workflow/workflow.module';
import { InquiriesModule } from './inquiries/inquiries.module';
import { QuestionnaireModule } from './questionnaire/questionnaire.module';
import { AgentsModule } from './agents/agents.module';
import { CommsModule } from './comms/comms.module';
import { ReportsModule } from './reports/reports.module';

@Module({
  imports: [
    AiModule, EventsModule, WorkflowModule,
    InquiriesModule, QuestionnaireModule, CommsModule, AgentsModule, ReportsModule,
  ],
  providers: [PrismaService, BossService],
  exports: [PrismaService, BossService],
})
export class AppModule {}
