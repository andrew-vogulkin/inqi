import { Module } from '@nestjs/common';
import { COMPLIANCE_SCORER } from './compliance.tokens';
import { ComplianceService } from './compliance.service';

/** Domain: the ethical+legal compliance gate, behind the `COMPLIANCE_SCORER` token. */
@Module({
  providers: [{ provide: COMPLIANCE_SCORER, useClass: ComplianceService }],
  exports: [COMPLIANCE_SCORER],
})
export class ComplianceModule {}
