import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { UsageService } from './usage.service';
import { CostSummary, rollupCost } from './cost';

/** Per-inquiry cost summary (HP-15): the append-only ledger rolled up with the config price table. */
@Injectable()
export class CostService {
  constructor(private readonly usage: UsageService, private readonly config: ConfigService) {}

  async summaryForInquiry({ inquiryId }: { inquiryId: string }): Promise<CostSummary> {
    const usageRecords = await this.usage.list({ inquiryId });
    return rollupCost({ usageRecords, priceTable: this.config.prices });
  }
}
