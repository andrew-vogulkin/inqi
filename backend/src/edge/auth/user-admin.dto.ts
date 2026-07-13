import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { AccountStatus, AuthRole } from '@inqi/shared';

/** Query params for the admin user directory (HP-25). */
export class UserSearchQueryDto {
  @ApiPropertyOptional({ description: 'Matches email or name — case-insensitive substring', example: 'ada@' })
  @IsOptional() @IsString()
  q?: string;

  @ApiPropertyOptional({ enum: AccountStatus, description: 'Narrow to active or suspended accounts; omit for all' })
  @IsOptional() @IsEnum(AccountStatus)
  status?: AccountStatus;

  @ApiPropertyOptional({ default: 25, description: 'Page size (1–50)' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'The `nextCursor` of the previous page (its last row email) — omit for the first page', example: 'ada@example.com' })
  @IsOptional() @IsString()
  cursor?: string;
}

/** One account in the admin directory. Status is derived from the suspension timestamp. */
export class UserRowDto {
  @ApiProperty({ example: 'clz1cust0000xy' })
  id!: string;

  @ApiProperty({ example: 'ada@example.com' })
  email!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Ada Lovelace' })
  name!: string | null;

  @ApiProperty({ enum: AuthRole, example: AuthRole.Customer })
  role!: AuthRole;

  @ApiProperty({ description: 'Registration date (account createdAt), ISO-8601', example: '2026-07-01T09:12:00.000Z' })
  registeredAt!: string;

  @ApiProperty({ enum: AccountStatus, example: AccountStatus.Active })
  status!: AccountStatus;

  @ApiProperty({ type: String, nullable: true, description: 'When the account was suspended (null = active)', example: null })
  suspendedAt!: string | null;

  @ApiProperty({ example: 3, description: 'Maintained credit balance' })
  credits!: number;

  @ApiProperty({ example: 12, description: 'Reports owned by this account (by FK or verified email)' })
  reportCount!: number;
}

/** One alphabetical page of the admin user directory. */
export class UserSearchResultDto {
  @ApiProperty({ type: [UserRowDto] })
  rows!: UserRowDto[];

  @ApiProperty({ type: String, nullable: true, example: 'bob@example.com', description: 'Pass back as `cursor` for the next page; null = no more rows' })
  nextCursor!: string | null;
}

/** Body for a suspend action — an optional operator note. */
export class SuspendUserDto {
  @ApiPropertyOptional({ description: 'Why the account is being suspended (kept in the audit trail)', example: 'Abuse: repeated spam requests', maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
