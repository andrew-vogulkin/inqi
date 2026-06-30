import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

/** Query params for the audit trail (HP-14). */
export class AuditQueryDto {
  @ApiPropertyOptional({ description: 'Scope to one inquiry', example: 'clz1abcd0000xy' })
  @IsOptional() @IsString()
  inquiryId?: string;

  @ApiPropertyOptional({ description: 'Comma-separated entry types: denial,compliance_block,agent_action,transition,operator_action', example: 'denial,compliance_block' })
  @IsOptional() @IsString()
  types?: string;

  @ApiPropertyOptional({ description: 'ISO lower bound (inclusive)', example: '2026-06-01T00:00:00.000Z' })
  @IsOptional() @IsString()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO upper bound (inclusive)', example: '2026-07-01T00:00:00.000Z' })
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
  @ApiProperty({ example: 'compliance_block' }) type!: string;
  @ApiProperty({ example: '2026-06-29T12:00:00.000Z' }) at!: string;
  @ApiProperty({ example: 'compliance' }) actor!: string;
  @ApiPropertyOptional({ example: 'prohibited item' }) reason?: string;
  @ApiPropertyOptional({ example: 'clz1abcd0000xy' }) inquiryId?: string;
  @ApiPropertyOptional({ type: Object, example: { targetType: 'inquiry', targetId: 'clz1abcd0000xy' } }) refs?: Record<string, unknown>;
  @ApiPropertyOptional({ type: Object, example: { surface: 'email', riskScore: 0.82 } }) data?: Record<string, unknown>;
}

export class AuditResultDto {
  @ApiProperty() total!: number;
  @ApiProperty({ type: [AuditEntryDto] }) entries!: AuditEntryDto[];
}
