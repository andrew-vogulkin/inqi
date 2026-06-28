import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

/** Optional audited reason for an operator run-control action (cancel/pause). */
export class OperatorActionDto {
  @ApiPropertyOptional({ description: 'Why the operator took this action (audited)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
