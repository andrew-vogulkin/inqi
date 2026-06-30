import { ApiProperty } from '@nestjs/swagger';

/** One ranked option in the live report (mirrors RankedOption). */
export class LiveOptionDto {
  @ApiProperty() subjectProvider!: string;
  @ApiProperty({ nullable: true }) price!: number | null;
  @ApiProperty({ nullable: true }) currency!: string | null;
  @ApiProperty({ nullable: true }) availability!: string | null;
  @ApiProperty({ nullable: true }) leadTime!: string | null;
  @ApiProperty({ description: '0..1 eligibility/quality score' }) qualityScore!: number;
  @ApiProperty({ description: 'blended quality+price rank score 0..1' }) score!: number;
  @ApiProperty({ required: false, nullable: true, type: Object }) background!: unknown;
}

/** Live-assembled report read surface (HP-08). */
export class LiveReportDto {
  @ApiProperty() inquiryId!: string;
  @ApiProperty({ description: 'current InquiryState' }) state!: string;
  @ApiProperty({ description: 'HP-23: derived InquiryStage (from state + qualifiedCount)' }) stage!: string;
  @ApiProperty({ description: 'HP-23: subtasks qualified so far' }) qualifiedCount!: number;
  @ApiProperty({ nullable: true, description: 'capability token for the pending questionnaire (Questionnaire stage)' }) questionnaireToken!: string | null;
  @ApiProperty({ nullable: true, type: Object, description: 'read-only answered scope (questions + answers) shown on the report' }) questionnaire!: { questions: unknown[]; answers: Record<string, string> | null; confirmed: boolean } | null;
  @ApiProperty() delivered!: boolean;
  @ApiProperty() rawRequest!: string;
  @ApiProperty({ nullable: true, description: 'snapshot id once generated (for POST /reports/:id/unlock)' }) reportId!: string | null;
  @ApiProperty({ nullable: true, description: 'snapshot webview token once delivered' }) reportToken!: string | null;
  @ApiProperty({ nullable: true }) reusedFrom!: string | null;
  @ApiProperty() summary!: string;
  @ApiProperty({ type: [LiveOptionDto] }) options!: LiveOptionDto[];
  @ApiProperty({ description: 'HP-21: free + locked → options redacted until unlocked' }) freemium!: boolean;
  @ApiProperty({ description: 'HP-21: revealed after a 1-credit unlock' }) unlocked!: boolean;
  @ApiProperty({ description: 'HP-21: number of withheld (locked) options' }) lockedCount!: number;
}
