import { ApiProperty } from '@nestjs/swagger';

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

/** Operator-only per-inquiry cost summary (HP-15) — never part of the customer report. */
export class CostSummaryDto {
  @ApiProperty({ example: 'USD' }) currency!: string;
  @ApiProperty({ type: [PerModelCostDto] }) perModel!: PerModelCostDto[];
  @ApiProperty({ type: OutreachCostDto }) outreach!: OutreachCostDto;
  @ApiProperty({ example: 16_200 }) tokenTotal!: number;
  @ApiProperty({ example: 0.0665 }) grandTotalUsd!: number;
}
