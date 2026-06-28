import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';

/** Admin top-up body (HP-19). */
export class TopUpDto {
  @ApiProperty({ example: 5, minimum: 1, description: 'Credits to grant (positive integer)' })
  @IsInt() @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'Onboarding grant', description: 'Audit note' })
  @IsOptional() @IsString() @MaxLength(280)
  note?: string;
}

/** A single ledger entry as returned to the customer. */
export class CreditEntryDto {
  @ApiProperty({ example: 'clz...' }) id!: string;
  @ApiProperty({ example: 'reserve', enum: ['topup', 'reserve', 'charge', 'refund'] }) kind!: string;
  @ApiProperty({ example: 1 }) amount!: number;
  @ApiPropertyOptional({ example: 'Onboarding grant' }) reason?: string | null;
  @ApiPropertyOptional({ example: 'system' }) actor?: string | null;
  @ApiPropertyOptional({ example: 'clz...' }) inquiryId?: string | null;
  @ApiProperty({ example: '2026-06-29T12:00:00.000Z' }) createdAt!: Date;
}

/** Customer credit balance + recent history (HP-19). */
export class CreditBalanceDto {
  @ApiProperty({ example: 3 }) balance!: number;
  @ApiProperty({ type: [CreditEntryDto] }) history!: CreditEntryDto[];
}

/** Result of an admin top-up. */
export class TopUpResultDto {
  @ApiProperty({ example: 'clz...' }) customerId!: string;
  @ApiProperty({ example: 8 }) balance!: number;
}
