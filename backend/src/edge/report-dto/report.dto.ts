import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ReportState, SearchFocus } from '@inqi/shared';

/** Report summary (scalar fields), as returned by create + list. */
export class ReportDto {
  @ApiProperty({ example: 'clz1abcd0000xy' })
  id!: string;

  @ApiProperty({ example: 'customer@example.com' })
  customerEmail!: string;

  @ApiProperty({ example: 'A second-hand road bike, 56cm frame, under €800.' })
  rawRequest!: string;

  @ApiProperty({ enum: Object.values(ReportState), example: ReportState.PRE_RESEARCH })
  state!: ReportState;

  @ApiPropertyOptional({ example: 'Researching', description: 'HP-23: derived ReportStage' })
  stage?: string;

  @ApiPropertyOptional({ example: 2, description: 'HP-23: inquiries qualified so far' })
  qualifiedCount?: number;

  @ApiPropertyOptional({ example: 'ellis', nullable: true, description: 'The persona carrying all interaction for this report' })
  personaId?: string | null;

  @ApiPropertyOptional({ enum: Object.values(SearchFocus), nullable: true, example: SearchFocus.Quality, description: 'Ranking priority (price | quality)' })
  focus?: SearchFocus | null;

  @ApiProperty({ example: 'clz1wf000def' })
  workflowVersionId!: string;

  @ApiPropertyOptional({ example: 800, nullable: true })
  budgetMax?: number | null;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  createdAt!: Date;
}

/** Report with its related aggregates (subject, questionnaire, epics, snapshot). */
export class ReportDetailDto extends ReportDto {
  @ApiPropertyOptional({
    type: 'object', additionalProperties: true, nullable: true,
    description: 'Enriched Subject row: { title, description, category (item|service|rental|organisation|goods|trade), attributes }',
    example: { title: 'Second-hand road bike', description: '56cm frame, under €800, Amsterdam area', category: 'goods' },
  })
  subject?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'object', additionalProperties: true, nullable: true,
    description: 'Questionnaire row: { id, token, questions[{id,prompt,options,multi}], answers, confirmed, reviewStatus, expiresAt }',
    example: { id: 'clz3q0001', confirmed: true, reviewStatus: 'passed', expiresAt: '2026-07-01T12:00:00.000Z' },
  })
  questionnaire?: Record<string, unknown> | null;

  @ApiPropertyOptional({
    type: 'array', items: { type: 'object', additionalProperties: true },
    description: 'Wave-orchestration epics with their inquiries: { id, status, strategy, targetQualifiedOptions, inquiries[{ id, name, status, wave, qualityScore, researchPending }] }',
    example: [{ id: 'clz2epic1', status: 'open', strategy: 'escalating', inquiries: [{ name: 'Acme Trading Co', status: 'qualified', wave: 1, qualityScore: 0.86 }] }],
  })
  epics?: Record<string, unknown>[];

  @ApiPropertyOptional({
    type: 'object', additionalProperties: true, nullable: true,
    description: 'Delivered ReportSnapshot: { id, token, summary, options[], timeline{generatedAt,refreshedAt}, freemium, unlocked }',
    example: { id: 'clz4rep0001', token: '2000564171a5…', summary: 'Found 3 qualified options.', freemium: false },
  })
  snapshot?: Record<string, unknown> | null;
}
