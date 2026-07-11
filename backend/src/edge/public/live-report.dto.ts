import { ApiProperty } from '@nestjs/swagger';
import { SearchFocus } from '@inqi/shared';

/** One ranked option in the live report (mirrors RankedOption). */
export class LiveOptionDto {
  @ApiProperty({ example: 'Acme Trading Co' }) subjectProvider!: string;
  @ApiProperty({ nullable: true, example: 290 }) price!: number | null;
  @ApiProperty({ nullable: true, example: 'EUR' }) currency!: string | null;
  @ApiProperty({ nullable: true, example: 'in stock' }) availability!: string | null;
  @ApiProperty({ nullable: true, example: '1-2 weeks' }) leadTime!: string | null;
  @ApiProperty({ description: '0..1 eligibility/quality score', example: 0.86 }) qualityScore!: number;
  @ApiProperty({ description: 'blended quality+price rank score 0..1', example: 0.74 }) score!: number;
  @ApiProperty({
    required: false, nullable: true, type: 'object', additionalProperties: true,
    description: 'Depth-research digest for the dossier: rating, reviewsCount, sentiment, themes, quotes, eligibility, redFlags, price/currency (web-evidenced), qualityScore, cited sources',
    example: { rating: 4.6, reviewsCount: 128, eligibility: 'eligible', redFlags: [], qualityScore: 0.86, sources: [{ source: 'TrustSite', url: 'https://example.com', snippet: 'Highly rated' }] },
  }) background!: unknown;
}

/** Read-only answered scope shown on the live report. */
export class LiveQuestionnaireDto {
  @ApiProperty({ type: 'array', items: { type: 'object', additionalProperties: true }, description: 'The questions as sent: { id, prompt, options[], multi }', example: [{ id: 'budget_band', prompt: 'What is your budget?', options: ['Under €500', '€500-1000', 'Decide for me'], multi: false }] })
  questions!: unknown[];
  @ApiProperty({ nullable: true, type: 'object', additionalProperties: { type: 'string' }, description: 'question id → chosen option', example: { budget_band: 'Under €500' } })
  answers!: Record<string, string> | null;
  @ApiProperty({ example: true, description: 'The mandatory subject-confirmation gate' })
  confirmed!: boolean;
}

/** Live-assembled report read surface (HP-08). */
export class LiveReportDto {
  @ApiProperty({ example: 'clz1abcd0000xy' }) reportId!: string;
  @ApiProperty({ nullable: true, description: 'human-facing reference (date-coded + per-day counter)', example: 'RPT-260707-03' }) ref!: string | null;
  @ApiProperty({ description: 'current ReportState', example: 'OUTREACH' }) state!: string;
  @ApiProperty({ description: 'HP-23: derived ReportStage (from state + qualifiedCount)', example: 'Researching' }) stage!: string;
  @ApiProperty({ description: 'HP-23: inquiries qualified so far', example: 2 }) qualifiedCount!: number;
  @ApiProperty({ nullable: true, description: 'capability token for the pending questionnaire (Questionnaire stage)', example: 'a1b2c3d4e5f6…' }) questionnaireToken!: string | null;
  @ApiProperty({ nullable: true, type: LiveQuestionnaireDto, description: 'read-only answered scope (questions + answers) shown on the report' }) questionnaire!: LiveQuestionnaireDto | null;
  @ApiProperty({ example: false, description: 'true once the snapshot is delivered (REPORT_DELIVERED)' }) delivered!: boolean;
  @ApiProperty({ example: 'A second-hand road bike, 56cm frame, under €800, around Amsterdam.' }) rawRequest!: string;
  @ApiProperty({ nullable: true, enum: Object.values(SearchFocus), example: SearchFocus.Quality, description: 'ranking priority the customer picked (price | quality)' }) focus!: SearchFocus | null;
  @ApiProperty({ nullable: true, description: 'snapshot id once generated (for POST /reports/:id/unlock)', example: 'clz4rep0001' }) snapshotId!: string | null;
  @ApiProperty({ nullable: true, description: 'snapshot webview token once delivered', example: '2000564171a5…' }) snapshotToken!: string | null;
  @ApiProperty({ nullable: true, example: null, description: 'source report id when this report was answered by prior-report reuse' }) reusedFrom!: string | null;
  @ApiProperty({ example: 'Bike Hub Lisboa leads on verified quality; two cheaper options trade rating for price.' }) summary!: string;
  @ApiProperty({ type: [LiveOptionDto] }) options!: LiveOptionDto[];
  @ApiProperty({ description: 'HP-21: free + locked → options redacted until unlocked' }) freemium!: boolean;
  @ApiProperty({ description: 'HP-21: revealed after a 1-credit unlock' }) unlocked!: boolean;
  @ApiProperty({ description: 'HP-21: number of withheld (locked) options' }) lockedCount!: number;

  @ApiProperty({
    type: 'array', items: { type: 'object', additionalProperties: true },
    description: 'Contacted/vetted providers that did NOT qualify (failed | unresponsive) — shown when the options list is thin/empty so the report reflects what was tried',
    example: [{ name: 'Acme Trading Co', status: 'unresponsive' }],
  })
  failedInquiries!: { name: string; status: string }[];
}
