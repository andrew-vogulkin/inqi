import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * One ranked option inside a snapshot. A freemium-LOCKED row is redacted to
 * `{ id, locked: true, rank }` only — every other field is withheld until unlock.
 */
export class SnapshotOptionDto {
  @ApiPropertyOptional({ example: 'Acme Trading Co', description: 'Provider name (absent on locked rows)' }) subjectProvider?: string;
  @ApiPropertyOptional({ nullable: true, example: 290 }) price?: number | null;
  @ApiPropertyOptional({ nullable: true, example: 'EUR' }) currency?: string | null;
  @ApiPropertyOptional({ nullable: true, example: 'in stock' }) availability?: string | null;
  @ApiPropertyOptional({ nullable: true, example: '1-2 weeks' }) leadTime?: string | null;
  @ApiPropertyOptional({ example: 0.86, description: '0..1 quality score from depth research' }) qualityScore?: number;
  @ApiPropertyOptional({ example: 0.74, description: 'blended quality+price rank score 0..1' }) score?: number;
  @ApiPropertyOptional({ example: 1, description: '1-based rank' }) rank?: number;
  @ApiPropertyOptional({ example: false, description: 'true = freemium-redacted row (unlock to reveal)' }) locked?: boolean;
}

/** Snapshot provenance timestamps. */
export class SnapshotTimelineDto {
  @ApiPropertyOptional({ example: '2026-06-28T12:00:00.000Z' }) generatedAt?: string;
  @ApiPropertyOptional({ example: '2026-06-28T14:30:00.000Z', description: 'set when late evidence re-ranked the delivered snapshot in place' }) refreshedAt?: string;
}

/** Report as shown in the customer webview (tokened, no login). */
export class ReportSnapshotDto {
  @ApiProperty({ example: 'clz4rep0001' })
  id!: string;

  @ApiProperty({ example: 'clz1abcd0000xy' })
  reportId!: string;

  @ApiProperty({ example: 'a1b2c3…' })
  token!: string;

  @ApiProperty({ example: 'Found 3 qualified options.' })
  summary!: string;

  @ApiProperty({ type: [SnapshotOptionDto], description: 'Ranked options; freemium-locked rows are redacted to { id, locked, rank }' })
  options!: unknown;

  @ApiProperty({ type: SnapshotTimelineDto })
  timeline!: unknown;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  createdAt!: Date;
}
