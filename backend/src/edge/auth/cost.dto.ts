import { ApiProperty } from '@nestjs/swagger';
import { WebSearchSource } from '@inqi/shared';

export class PerModelCostDto {
  @ApiProperty({ example: 'qwen-max' }) model!: string;
  @ApiProperty({ example: 12_400 }) promptTokens!: number;
  @ApiProperty({ example: 3_800 }) completionTokens!: number;
  @ApiProperty({ example: 0.0665 }) estUsd!: number;
}

export class OutreachCostDto {
  @ApiProperty({ example: 8 }) emails!: number;
  @ApiProperty({ example: 5 }) replies!: number;
  @ApiProperty({ example: 3 }) discovery!: number;
  @ApiProperty({ example: 8 }) research!: number;
  @ApiProperty({ example: 1 }) embeddings!: number;
  @ApiProperty({ example: 0.0 }) estUsd!: number;
}

export class WebSearchSourceCountDto {
  @ApiProperty({ enum: WebSearchSource, example: WebSearchSource.BreadthSearch, description: 'Which pipeline phase fired these searches' }) source!: WebSearchSource;
  @ApiProperty({ example: 979 }) calls!: number;
}

export class WebSearchCostDto {
  @ApiProperty({ example: 42, description: 'Every web search fired for this report (breadth cycles, marketing pass, depth leads/tools)' }) calls!: number;
  @ApiProperty({ example: 'searxng', description: 'The serving search provider(s)' }) provider!: string;
  @ApiProperty({ example: 0.021 }) estUsd!: number;
  @ApiProperty({ type: [WebSearchSourceCountDto], description: 'Per-phase breakdown of the search count' }) bySource!: WebSearchSourceCountDto[];
}

/** Operator-only per-report cost summary (HP-15) — never part of the customer report. */
export class CostSummaryDto {
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ type: [PerModelCostDto] }) perModel!: PerModelCostDto[];
  @ApiProperty({ type: OutreachCostDto }) outreach!: OutreachCostDto;
  @ApiProperty({ type: WebSearchCostDto }) webSearch!: WebSearchCostDto;
  @ApiProperty({ example: 16_200 }) tokenTotal!: number;
  @ApiProperty({ example: 0.0665 }) grandTotalUsd!: number;
}
