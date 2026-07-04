import { Injectable } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { UsageService } from './usage.service';
import { CostSummary, rollupCost } from './cost';

/** Per-report cost summary (HP-15): the append-only ledger rolled up with the config price table. */
@Injectable()
export class CostService {
  constructor(private readonly usage: UsageService, private readonly config: ConfigService) {}

  async summaryForReport({ reportId }: { reportId: string }): Promise<CostSummary> {
    const usageRecords = await this.usage.list({ reportId });
    return rollupCost({ usageRecords, priceTable: this.config.prices });
  }
}
