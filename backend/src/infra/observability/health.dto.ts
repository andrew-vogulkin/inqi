import { ApiProperty } from '@nestjs/swagger';

/** Liveness response. */
export class HealthDto {
  @ApiProperty({ example: 'ok' })
  status!: string;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  at!: string;
}
