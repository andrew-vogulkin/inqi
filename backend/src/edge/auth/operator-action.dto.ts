import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ReportState } from '@inqi/shared';

/** Optional audited reason for an operator run-control action (cancel/pause). */
export class OperatorActionDto {
  @ApiPropertyOptional({ description: 'Why the operator took this action (audited)', example: 'duplicate request' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

/** Result of an operator run-control action (cancel/pause/resume): the report's resulting state. */
export class OperationResultDto {
  @ApiProperty({ example: 'clz1abcd0000xy' }) id!: string;
  @ApiProperty({ enum: Object.values(ReportState), example: ReportState.CANCELLED }) state!: string;
}
