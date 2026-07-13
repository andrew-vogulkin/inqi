import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '../../infra/config/config.service';
import { CustomerService } from '../customer/customer.service';
import { ReportService } from '../report/report.service';

/** Acknowledgement returned for an inbound email that started a new report (HP-27). */
export interface IntakeAck {
  intake: true;
  reportId: string;
  ref: string | null;
}

/**
 * HP-27 — email intake: an inbound email TO the configured intake address starts a
 * brand-new report owned by the sender. The account is auto-created (upsert by
 * from-address); the pipeline then runs autopilot (auto-answered questionnaire) and
 * delivers back over email. The raw request's own compliance gate runs in
 * pre-research, exactly like a web submit — nothing is trusted here.
 */
@Injectable()
export class IntakeService {
  private readonly logger = new Logger(IntakeService.name);

  constructor(
    private readonly customers: CustomerService,
    private readonly reports: ReportService,
    private readonly config: ConfigService,
  ) {}

  /** True iff this inbound was addressed to the intake mailbox (case-insensitive, full address). */
  isIntakeAddress(toAddr?: string): boolean {
    const intake = this.config.intakeAddress;
    return !!intake && !!toAddr && toAddr.trim().toLowerCase() === intake;
  }

  /** Create a report from an inbound intake email. Sender = owner (auto-created). */
  async createReportFromEmail({ fromAddr, subject, body }: { fromAddr?: string; subject?: string; body: string }): Promise<IntakeAck> {
    const email = (fromAddr ?? '').trim().toLowerCase();
    if (!email) {
      // No sender to own the report — nothing we can safely do with it.
      throw new Error('intake email has no From address');
    }
    // Subject carries intent ("Need a wedding photographer…"); fold it in front of the body.
    const rawRequest = [subject?.trim(), body?.trim()].filter(Boolean).join('\n\n') || subject || body || '';
    const customer = await this.customers.upsertByEmail({ email });
    const report = await this.reports.createFromEmail({ rawRequest, customer: { id: customer.id, email: customer.email } });
    this.logger.log(`email intake → report ${report.ref ?? report.id} for ${email}`);
    return { intake: true, reportId: report.id, ref: report.ref };
  }
}
