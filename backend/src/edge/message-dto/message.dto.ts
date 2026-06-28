import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MessageDirection, MessageStatus } from '@inqi/shared';

/** An email message in a subtask thread. */
export class MessageDto {
  @ApiProperty({ example: 'clz2msg0001' })
  id!: string;

  @ApiProperty({ example: 'clz2sub0001' })
  subtaskId!: string;

  @ApiProperty({ enum: Object.values(MessageDirection), example: MessageDirection.Outbound })
  direction!: MessageDirection;

  @ApiProperty({ enum: Object.values(MessageStatus), example: MessageStatus.Sent })
  status!: MessageStatus;

  @ApiPropertyOptional({ example: 'abc123@reply.inqi.example', nullable: true })
  fromAddr?: string | null;

  @ApiPropertyOptional({ example: 'sales@provider.example', nullable: true })
  toAddr?: string | null;

  @ApiPropertyOptional({ example: 'Inquiry: road bike', nullable: true })
  subject?: string | null;

  @ApiProperty({ example: 'Hello, could you share price and availability?' })
  body!: string;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  createdAt!: Date;
}
