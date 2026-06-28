import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InquiryState } from '@inqi/shared';

/** Inquiry summary (scalar fields), as returned by create + list. */
export class InquiryDto {
  @ApiProperty({ example: 'clz1abcd0000xy' })
  id!: string;

  @ApiProperty({ example: 'customer@example.com' })
  customerEmail!: string;

  @ApiProperty({ example: 'A second-hand road bike, 56cm frame, under €800.' })
  rawRequest!: string;

  @ApiProperty({ enum: Object.values(InquiryState), example: InquiryState.PRE_RESEARCH })
  state!: InquiryState;

  @ApiProperty({ example: 'clz1wf000def' })
  workflowVersionId!: string;

  @ApiPropertyOptional({ example: 800, nullable: true })
  budgetMax?: number | null;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  createdAt!: Date;
}

/** Inquiry with its related aggregates (subject, questionnaire, epics, report). */
export class InquiryDetailDto extends InquiryDto {
  @ApiPropertyOptional({ type: Object, nullable: true })
  subject?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: Object, nullable: true })
  questionnaire?: Record<string, unknown> | null;

  @ApiPropertyOptional({ type: [Object] })
  epics?: Record<string, unknown>[];

  @ApiPropertyOptional({ type: Object, nullable: true })
  report?: Record<string, unknown> | null;
}
