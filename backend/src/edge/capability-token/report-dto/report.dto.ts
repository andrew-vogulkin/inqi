import { ApiProperty } from '@nestjs/swagger';

/** Report as shown in the customer webview (tokened, no login). */
export class ReportDto {
  @ApiProperty({ example: 'clz4rep0001' })
  id!: string;

  @ApiProperty({ example: 'clz1abcd0000xy' })
  inquiryId!: string;

  @ApiProperty({ example: 'a1b2c3…' })
  token!: string;

  @ApiProperty({ example: 'Found 3 qualified options.' })
  summary!: string;

  @ApiProperty({ type: Object, example: [{ subjectProvider: 'Subject Provider 1', price: 290, currency: 'EUR' }] })
  options!: unknown;

  @ApiProperty({ type: Object, example: { generatedAt: '2026-06-28T12:00:00.000Z' } })
  timeline!: unknown;

  @ApiProperty({ example: '2026-06-28T12:00:00.000Z' })
  createdAt!: Date;
}
