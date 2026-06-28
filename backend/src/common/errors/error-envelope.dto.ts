import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from './error-code.enum';

/** Body of the standard error envelope. */
export class ErrorBodyDto {
  @ApiProperty({ enum: Object.values(ErrorCode), example: ErrorCode.OutreachBlockedByCompliance })
  code!: ErrorCode;

  @ApiProperty({ example: 'Outbound email blocked by the compliance gate.' })
  message!: string;

  @ApiProperty({ example: false, description: 'Whether the orchestrator may safely retry.' })
  retryable!: boolean;

  @ApiProperty({ type: Object, example: { riskTags: ['policy'] }, description: 'Structured context (never secrets).' })
  details!: Record<string, unknown>;
}

/** Stable error envelope returned for every failed request. */
export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
