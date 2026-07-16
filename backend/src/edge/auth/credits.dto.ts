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
  @ApiPropertyOptional({ example: 'clz...' }) reportId?: string | null;
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

/** A customer in the admin directory/search results (HP-22). */
export class CustomerDirectoryDto {
  @ApiProperty({ example: 'clz...' }) id!: string;
  @ApiProperty({ example: 'Ada Lovelace' }) name!: string;
  @ApiProperty({ example: 'ada@example.com' }) email!: string;
}

/** Customer's credit top-up request body. */
export class CreateCreditRequestDto {
  @ApiProperty({ example: 5, minimum: 1, description: 'Credits requested (positive integer)' })
  @IsInt() @Min(1)
  amount!: number;

  @ApiPropertyOptional({ example: 'Running a batch of reports this week', description: 'Reason (optional)' })
  @IsOptional() @IsString() @MaxLength(280)
  note?: string;
}

/** Admin approve body — an optional amount override (defaults to the requested amount). */
export class ApproveCreditRequestDto {
  @ApiPropertyOptional({ example: 8, minimum: 1, description: 'Credits to grant; omit to grant the requested amount' })
  @IsOptional() @IsInt() @Min(1)
  amount?: number;
}

/** A pending credit request in the operator queue. */
export class CreditRequestDto {
  @ApiProperty({ example: 'clz...' }) id!: string;
  @ApiProperty({ example: 'clz...' }) customerId!: string;
  @ApiProperty({ example: 'ada@example.com' }) email!: string;
  @ApiPropertyOptional({ example: 'Ada Lovelace' }) name?: string | null;
  @ApiProperty({ example: 5 }) amount!: number;
  @ApiPropertyOptional({ example: 'Running a batch this week' }) note?: string | null;
  @ApiProperty({ example: '2026-07-16T12:00:00.000Z' }) createdAt!: Date;
}
