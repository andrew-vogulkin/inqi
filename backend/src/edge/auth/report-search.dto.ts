import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ReportDto } from '../report-dto/report.dto';

/** Query params for the admin report search (the operator report picker). */
export class ReportSearchQueryDto {
  @ApiPropertyOptional({ description: 'Matches the report ref (RPT-260711-01), the customer email, or the request text — case-insensitive substring', example: 'RPT-260711' })
  @IsOptional() @IsString()
  q?: string;

  @ApiPropertyOptional({ default: 10, description: 'Page size; the picker default is the last 10 reports' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'The `nextCursor` of the previous page (its last row id) — omit for the first page', example: 'clz1abcd0000xy' })
  @IsOptional() @IsString()
  cursor?: string;
}

/** One page of the admin report search, newest-first. */
export class ReportSearchResultDto {
  @ApiProperty({ type: [ReportDto] })
  rows!: ReportDto[];

  @ApiProperty({ type: String, nullable: true, example: 'clz1abcd0000xy', description: 'Pass back as `cursor` for the next (older) page; null = no more rows' })
  nextCursor!: string | null;
}
