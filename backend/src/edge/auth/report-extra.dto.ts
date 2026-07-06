import { ApiProperty } from '@nestjs/swagger';

/** Result of a freemium unlock (POST /reports/:id/unlock; HP-21). */
export class UnlockResultDto {
  @ApiProperty({ example: 'clz...' }) id!: string;
  @ApiProperty({ example: true }) unlocked!: boolean;
  @ApiProperty({ example: 2, description: 'credit balance after the charge' }) balance!: number;
}
