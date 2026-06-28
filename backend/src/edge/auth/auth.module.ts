import { Module } from '@nestjs/common';
import { AuthVerifierDriver } from '@inqi/shared';
import { InquiryModule } from '../../domain/inquiry/inquiry.module';
import { KanbanModule } from '../../domain/kanban/kanban.module';
import { CustomerModule } from '../../domain/customer/customer.module';
import { OrchestratorWorkersModule } from '../../domain/orchestrator/orchestrator-workers.module';
import { ConfigService } from '../../infra/config/config.service';
import { AdminInquiriesController } from './admin-inquiries.controller';
import { AdminThreadController } from './admin-thread.controller';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { TOKEN_VERIFIER } from './auth.tokens';
import { GoogleTokenVerifier } from './google-token.verifier';
import { StubTokenVerifier } from './stub-token.verifier';

/**
 * Edge: authentication (Sign in with Google) + authenticated dashboards. The
 * identity verifier is driver-selected — real Google when GOOGLE_CLIENT_ID is set,
 * else the dev/e2e stub.
 */
@Module({
  imports: [InquiryModule, KanbanModule, CustomerModule, OrchestratorWorkersModule],
  controllers: [AuthController, AdminInquiriesController, AdminThreadController],
  providers: [
    AuthService,
    SessionService,
    AuthGuard,
    AdminGuard,
    GoogleTokenVerifier,
    StubTokenVerifier,
    {
      provide: TOKEN_VERIFIER,
      inject: [ConfigService, GoogleTokenVerifier, StubTokenVerifier],
      useFactory: (config: ConfigService, google: GoogleTokenVerifier, stub: StubTokenVerifier) =>
        config.authVerifier === AuthVerifierDriver.Google ? google : stub,
    },
  ],
})
export class AuthModule {}
