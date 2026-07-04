import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDateString, IsIn, IsInt, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { SearchFocus } from '@inqi/shared';
import type { CreateReportDto as ICreateReport } from '@inqi/shared';

export class GeoDto {
  @ApiProperty({ example: 52.3676 })
  @IsNumber()
  lat!: number;

  @ApiProperty({ example: 4.9041 })
  @IsNumber()
  lng!: number;

  @ApiPropertyOptional({ example: 'Amsterdam, NL' })
  @IsOptional() @IsString()
  label?: string;
}

/**
 * Body for submitting a new report. HP-19: intake is authenticated — the owner is
 * the signed-in customer (from the session), so `customerEmail` is no longer accepted
 * here (a stray field would be rejected by the whitelist validation pipe).
 */
export class CreateReportDto implements ICreateReport {
  @ApiProperty({ example: 'A second-hand road bike, 56cm frame, under €800, around Amsterdam.' })
  @IsString() @IsNotEmpty()
  rawRequest!: string;

  @ApiPropertyOptional({ type: GeoDto })
  @IsOptional() @ValidateNested() @Type(() => GeoDto)
  geo?: GeoDto;

  @ApiPropertyOptional({ example: 100 })
  @IsOptional() @IsInt()
  budgetMin?: number;

  @ApiPropertyOptional({ example: 800 })
  @IsOptional() @IsInt()
  budgetMax?: number;

  @ApiPropertyOptional({ example: '2026-08-01T00:00:00.000Z', description: 'ISO 8601 deadline' })
  @IsOptional() @IsDateString()
  deadline?: string;

  @ApiPropertyOptional({ enum: Object.values(SearchFocus), example: SearchFocus.Quality, description: 'Ranking priority — what depth research hunts hardest for (default: quality)' })
  @IsOptional() @IsIn(Object.values(SearchFocus))
  focus?: SearchFocus;
}
