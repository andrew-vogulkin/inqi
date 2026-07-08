import { Module } from '@nestjs/common';
import { ReportModule } from '../../domain/report/report.module';
import { KanbanModule } from '../../domain/kanban/kanban.module';
import { CustomerModule } from '../../domain/customer/customer.module';
import { CreditsModule } from '../../domain/credits/credits.module';
import { SnapshotsModule } from '../../domain/snapshot/snapshots.module';
import { OrchestratorWorkersModule } from '../../domain/orchestrator/orchestrator-workers.module';
import { SourcesModule } from '../../domain/source/sources.module';
import { AdminReportsController } from './admin-reports.controller';
import { AdminThreadController } from './admin-thread.controller';
import { AuthedSnapshotsController } from './authed-snapshots.controller';
import { WorkflowsController } from './workflows.controller';
import { AuditController } from './audit.controller';
import { MeCreditsController, AdminCustomersController } from './credits.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { MfaCodeStore } from './mfa-code.store';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';

/**
 * Edge: authentication (two-step email sign-in: email → MFA code — `mock`
 * transport by default, real emailed codes when MFA_TRANSPORT=email via
 * SourcesModule's MAIL_PROVIDER) + authenticated dashboards.
 */
@Module({
  imports: [ReportModule, KanbanModule, CustomerModule, CreditsModule, SnapshotsModule, OrchestratorWorkersModule, SourcesModule],
  controllers: [AuthController, AdminReportsController, AdminThreadController, AuthedSnapshotsController, WorkflowsController, AuditController, MeCreditsController, AdminCustomersController],
  providers: [AuthService, SessionService, MfaCodeStore, AuthGuard, AdminGuard],
  // HP-24: the former capability-token / public read surfaces now sit behind AuthGuard too.
  exports: [SessionService, AuthGuard],
})
export class AuthModule {}
