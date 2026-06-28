import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsObject } from 'class-validator';
import { ReviewStatus } from '@inqi/shared';
import type { QuestionnaireAnswersDto as IAnswers } from '@inqi/shared';

/** Body for submitting questionnaire answers (tokened, no login). */
export class QuestionnaireAnswersDto implements IAnswers {
  @ApiProperty({ example: true, description: 'Customer confirms the subject is correct (mandatory gate).' })
  @IsBoolean()
  confirmedSubject!: boolean;

  @ApiProperty({ type: Object, example: { budget: '500-800', where: 'Amsterdam, 25km', when: 'within a month' } })
  @IsObject()
  answers!: Record<string, string>;
}

/** Questionnaire as shown to the customer via the tokened link. */
export class QuestionnaireDto {
  @ApiProperty({ example: 'clz3q0001' })
  id!: string;

  @ApiProperty({ example: 'clz1abcd0000xy' })
  inquiryId!: string;

  @ApiProperty({ example: 'a1b2c3…' })
  token!: string;

  @ApiProperty({ type: Object, example: [{ id: 'budget', prompt: 'What is your budget range?', type: 'text' }] })
  questions!: unknown;

  @ApiProperty({ enum: Object.values(ReviewStatus), example: ReviewStatus.Passed })
  reviewStatus!: ReviewStatus;

  @ApiProperty({ example: false })
  confirmed!: boolean;

  @ApiProperty({ example: '2026-07-01T12:00:00.000Z' })
  expiresAt!: Date;
}

/** Result of submitting questionnaire answers. */
export class SubmitResultDto {
  @ApiProperty({ example: true })
  ok!: boolean;
}
