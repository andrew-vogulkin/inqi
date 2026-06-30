import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OutreachOutcome, ProvenanceDepth } from '@inqi/shared';

/** A web source inqi consulted for one option. */
export class ProvenanceWebDto {
  @ApiProperty({ example: 'TrustSite' }) source!: string;
  @ApiProperty({ example: 'https://example.com/review' }) url!: string;
  @ApiProperty({ example: 'Highly rated, fast delivery.' }) snippet!: string;
}

/** Aggregated review signal for one option. */
export class ProvenanceFeedbackDto {
  @ApiProperty({ example: 4.6 }) rating!: number;
  @ApiProperty({ example: 0.7, description: 'Sentiment in [-1, 1]' }) sentiment!: number;
  @ApiProperty({ type: [String], example: ['fast shipping', 'responsive'] }) themes!: string[];
  @ApiProperty({ type: [String], example: ['Great service, would recommend.'] }) quotes!: string[];
}

/** The blended scoring + final rank for one option. */
export class ProvenanceScoringDto {
  @ApiProperty({ example: 0.8 }) feedbackScore!: number;
  @ApiProperty({ example: 0.6 }) priceScore!: number;
  @ApiProperty({ example: 0.72 }) blendedScore!: number;
  @ApiProperty({ example: 1 }) rank!: number;
}

/** Redacted outreach summary (persona + generic relay + outcome — never addresses/bodies). */
export class ProvenanceOutreachDto {
  @ApiProperty({ example: 'persona_ams' }) persona!: string;
  @ApiProperty({ example: 'via inqi' }) route!: string;
  @ApiProperty({ enum: Object.values(OutreachOutcome), example: OutreachOutcome.Replied }) outcome!: OutreachOutcome;
}

/** AI transparency summaries — how inqi evaluated this option, per section. */
export class ProvenanceSummariesDto {
  @ApiProperty({ example: 'Well rated online with strong delivery reviews.' }) web!: string;
  @ApiProperty({ example: 'Replied within 2 hours with a clear quote.' }) outreach!: string;
  @ApiProperty({ example: 'Recent reviews praise reliability.' }) feedback!: string;
  @ApiProperty({ example: 'Ranked #1 on blended quality and price.' }) ranking!: string;
}

/** Customer-safe provenance for one ranked option (HP-20). */
export class OptionProvenanceDto {
  @ApiProperty({ type: [ProvenanceWebDto] }) web!: ProvenanceWebDto[];
  @ApiProperty({ type: ProvenanceFeedbackDto }) feedback!: ProvenanceFeedbackDto;
  @ApiProperty({ type: ProvenanceScoringDto }) scoring!: ProvenanceScoringDto;
  @ApiProperty({ type: ProvenanceOutreachDto }) outreach!: ProvenanceOutreachDto;
  @ApiProperty({ enum: Object.values(ProvenanceDepth), example: ProvenanceDepth.WebOutreachFeedback }) depth!: ProvenanceDepth;
  @ApiPropertyOptional({ type: ProvenanceSummariesDto }) summaries?: ProvenanceSummariesDto;
}
