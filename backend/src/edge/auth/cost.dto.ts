import { ApiProperty } from '@nestjs/swagger';

export class PerModelCostDto {
  @ApiProperty() model!: string;
  @ApiProperty() promptTokens!: number;
  @ApiProperty() completionTokens!: number;
  @ApiProperty() estUsd!: number;
}

export class OutreachCostDto {
  @ApiProperty() emails!: number;
  @ApiProperty() replies!: number;
  @ApiProperty() discovery!: number;
  @ApiProperty() research!: number;
  @ApiProperty() embeddings!: number;
  @ApiProperty() estUsd!: number;
}

/** Operator-only per-inquiry cost summary (HP-15) — never part of the customer report. */
export class CostSummaryDto {
  @ApiProperty() currency!: string;
  @ApiProperty({ type: [PerModelCostDto] }) perModel!: PerModelCostDto[];
  @ApiProperty({ type: OutreachCostDto }) outreach!: OutreachCostDto;
  @ApiProperty() tokenTotal!: number;
  @ApiProperty() grandTotalUsd!: number;
}
