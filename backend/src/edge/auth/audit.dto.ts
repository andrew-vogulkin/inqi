import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params for the audit trail (HP-14). */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Scope to one inquiry' })
  @IsOptional() @IsString()
  inquiryId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated entry types: denial,compliance_block,agent_action,transition,operator_action' })
  @IsOptional() @IsString()
  types?: string;

  @ApiPropertyOptional({ description: 'ISO lower bound (inclusive)' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO upper bound (inclusive)' })
  @IsOptional() @IsString()
  to?: string;

  @ApiPropertyOptional({ default: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset?: number;
}

export class AuditEntryDto {
  @ApiProperty() type!: string;
  @ApiProperty() at!: string;
  @ApiProperty() actor!: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() inquiryId?: string;
  @ApiPropertyOptional({ type: Object }) refs?: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object }) data?: Record<string, unknown>;
}

export class AuditResultDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [AuditEntryDto] }) entries!: AuditEntryDto[];
}
