import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { CostSummaryDto } from './cost.dto';

/** Query params for the aggregate usage report (HP-15). Dates: `YYYY-MM-DD` or full ISO. */
export class UsageReportQueryDto {
  @ApiPropertyOptional({ description: 'Include reports created on/after this date (inclusive)', example: '2026-07-01' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'Include reports created on/before this date (inclusive)', example: '2026-07-13' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 500, description: 'Max reports rolled up (safety cap)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;
}

/** One report's contribution to the aggregate. */
export class UsageReportRowDto {
  @ApiProperty({ example: 'clz1abcd0000xy' }) id!: string;
  @ApiProperty({ type: String, nullable: true, example: 'RPT-260713-02' }) ref!: string | null;
  @ApiProperty({ example: 'REPORT_DELIVERED' }) state!: string;
  @ApiProperty({ example: '2026-07-13T05:59:44.000Z' }) createdAt!: string;
  @ApiProperty({ example: 'ada@example.com' }) customerEmail!: string;
  @ApiProperty({ example: 0.8692 }) costUsd!: number;
  @ApiProperty({ example: 16_200 }) tokenTotal!: number;
  @ApiProperty({ example: 40 }) webSearchCalls!: number;
  @ApiProperty({ example: 8 }) emailCount!: number;
}

/** Aggregate usage across all reports in a date window. */
export class UsageReportResultDto {
  @ApiProperty({ type: String, nullable: true, example: '2026-07-01' }) from!: string | null;
  @ApiProperty({ type: String, nullable: true, example: '2026-07-13' }) to!: string | null;
  @ApiProperty({ example: 12 }) reportCount!: number;
  @ApiProperty({ type: CostSummaryDto, description: 'Combined cost rollup across every included report' }) totals!: CostSummaryDto;
  @ApiProperty({ type: [UsageReportRowDto], description: 'Every report that contributed, newest first' }) reports!: UsageReportRowDto[];
}
