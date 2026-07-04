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

  @ApiProperty({ type: 'object', additionalProperties: true, example: { riskTags: ['policy'] }, description: 'Structured context for the code — e.g. { required, balance } on 402, { guard } on 409. Never secrets.' })
  details!: Record<string, unknown>;
}

/** Stable error envelope returned for every failed request. */
export class ErrorEnvelopeDto {
  @ApiProperty({ type: ErrorBodyDto })
  error!: ErrorBodyDto;
}
