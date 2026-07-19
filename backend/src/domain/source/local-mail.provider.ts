import { Injectable, Logger } from '@nestjs/common';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { ConfigService } from '../../infra/config/config.service';
import { MailProvider, SendMailArgs, SendMailResult } from './mail.provider';

/**
 * Local mail transport for development/testing. Captures each outbound email to a
 * JSON file under `LOCAL_MAIL_DIR` (nothing leaves the machine). Bound to the
 * `MAIL_PROVIDER` token when `mailDriver` is `local`. Simulated vendor replies are
 * NOT this provider's job — {@link SimulatedRepliesMailProvider} decorates any
 * transport (this one or Postmark) when SIMULATE_REPLIES is on.
 */
@Injectable()
export class LocalMailProvider implements MailProvider {
  private readonly logger = new Logger(LocalMailProvider.name);
  /** In-memory log of captured emails (most recent last) for inspection in tests. */
  readonly sent: Array<SendMailArgs & SendMailResult> = [];

  constructor(private readonly config: ConfigService) {}

  async send(args: SendMailArgs): Promise<SendMailResult> {
    const externalId = `<${randomUUID()}@inqi.local>`;
    const record = { ...args, externalId };
    this.sent.push(record);
    this.capture(record);
    return { externalId };
  }

  private capture(record: SendMailArgs & SendMailResult): void {
    const dir = this.config.localMailDir;
    try {
      mkdirSync(dir, { recursive: true });
      const file = join(dir, `${Date.now()}-${randomUUID().slice(0, 8)}.json`);
      writeFileSync(file, JSON.stringify(record, null, 2));
      this.logger.log(`captured email → ${file} (to: ${record.to ?? 'n/a'}, subject: ${record.subject})`);
    } catch (e) {
      this.logger.warn(`could not write captured email to ${dir}: ${(e as Error).message}`);
    }
  }
}
