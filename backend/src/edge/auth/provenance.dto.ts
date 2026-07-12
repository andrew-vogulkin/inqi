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

/** One message of the outreach conversation (no addresses/message ids). */
export class ProvenanceChainMessageDto {
  @ApiProperty({ example: 'outbound' }) direction!: string;
  @ApiProperty({ nullable: true, example: 'Inquiry: Surf School Weekend Package', description: 'The email subject as sent (threaded with Re: on follow-ups)' }) subject!: string | null;
  @ApiProperty({ example: 'Hello — could you share price and availability?' }) body!: string;
  @ApiProperty({ example: '2026-07-02T16:36:39.000Z' }) at!: string;
  @ApiPropertyOptional({ nullable: true, example: 'sales', description: 'Thread channel label when the provider has several contacts (sales, booking, …)' }) channel?: string | null;
}

/** Outreach summary + the full email chain as it happened (relay addresses/ids stay internal). */
export class ProvenanceOutreachDto {
  @ApiProperty({ example: 'persona_ams' }) persona!: string;
  @ApiProperty({ example: 'via inqi' }) route!: string;
  @ApiProperty({ enum: Object.values(OutreachOutcome), example: OutreachOutcome.Replied }) outcome!: OutreachOutcome;
  @ApiProperty({ type: [ProvenanceChainMessageDto] }) chain!: ProvenanceChainMessageDto[];
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
  @ApiPropertyOptional({ example: false, description: 'True while the inquiry’s depth research is still queued/running — sections may still fill in' }) researchPending?: boolean;
  @ApiPropertyOptional({ type: ProvenanceSummariesDto }) summaries?: ProvenanceSummariesDto;
  @ApiPropertyOptional({ example: false, description: 'False when this provider was contacted/vetted but did NOT qualify (unranked; scoring.rank = 0)' }) qualified?: boolean;
  @ApiPropertyOptional({ example: 'no evidence the vendor exists in the requested location', nullable: true, description: 'The vet verdict’s reason when qualified=false' }) disqualifyReason?: string | null;
}
