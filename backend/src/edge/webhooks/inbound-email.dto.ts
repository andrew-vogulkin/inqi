import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString } from 'class-validator';

/** A single RFC 5322 header as delivered in a Postmark inbound payload. */
export class InboundHeaderDto {
  @ApiPropertyOptional({ example: 'In-Reply-To' })
  @IsOptional() @IsString()
  Name?: string;

  @ApiPropertyOptional({ example: '<msg-0@inqi>' })
  @IsOptional() @IsString()
  Value?: string;
}

/**
 * Inbound email webhook payload (Postmark inbound parse → /api/comms/inbound).
 * Accepts both Postmark field names (capitalized) and internal lowercase keys;
 * a route-level whitelist pipe strips the many other Postmark fields.
 */
export class InboundEmailDto {
  // --- internal / lowercase ---
  @ApiPropertyOptional({ example: 'abc123@reply.inqi.example' })
  @IsOptional() @IsString() to?: string;
  @ApiPropertyOptional({ example: 'abc123@reply.inqi.example', description: 'Alias of `to` — the per-thread reply address that routes the email to its inquiry' })
  @IsOptional() @IsString() toAddr?: string;
  @ApiPropertyOptional({ example: 'sales@provider.example' })
  @IsOptional() @IsString() from?: string;
  @ApiPropertyOptional({ example: 'sales@provider.example', description: 'Alias of `from` — the provider address' })
  @IsOptional() @IsString() fromAddr?: string;
  @ApiPropertyOptional({ example: 'Re: report' })
  @IsOptional() @IsString() subject?: string;
  @ApiPropertyOptional({ example: 'Yes, in stock. Price 290 EUR, lead time 1-2 weeks.' })
  @IsOptional() @IsString() text?: string;
  @ApiPropertyOptional({ example: 'Yes, in stock. Price 290 EUR, lead time 1-2 weeks.', description: 'Alias of `text` — plain-text reply body' })
  @IsOptional() @IsString() body?: string;
  @ApiPropertyOptional({ example: '<msg-1@provider>' })
  @IsOptional() @IsString() messageId?: string;
  @ApiPropertyOptional({ example: '<msg-1@provider>', description: 'Alias of `messageId` — counterparty Message-ID (threading + idempotency key)' })
  @IsOptional() @IsString() externalId?: string;
  @ApiPropertyOptional({ example: '<msg-0@inqi>' })
  @IsOptional() @IsString() inReplyTo?: string;
  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @IsArray() references?: string[];

  // --- Postmark inbound parse (capitalized) ---
  @ApiPropertyOptional({ example: 'sales@provider.example' })
  @IsOptional() @IsString() From?: string;
  @ApiPropertyOptional({ example: 'abc123@reply.inqi.example' })
  @IsOptional() @IsString() To?: string;
  @ApiPropertyOptional({ example: 'abc123@reply.inqi.example', description: 'Bare delivered recipient address' })
  @IsOptional() @IsString() OriginalRecipient?: string;
  @ApiPropertyOptional({ example: 'Re: report' })
  @IsOptional() @IsString() Subject?: string;
  @ApiPropertyOptional({ example: 'Yes, in stock. Price 290 EUR, lead time 1-2 weeks.', description: 'Postmark plain-text body (preferred over HtmlBody)' })
  @IsOptional() @IsString() TextBody?: string;
  @ApiPropertyOptional({ example: '<p>Yes, in stock…</p>', description: 'Postmark HTML body (fallback when TextBody is absent)' })
  @IsOptional() @IsString() HtmlBody?: string;
  @ApiPropertyOptional({ example: 'a1b2c3d4-...' })
  @IsOptional() @IsString() MessageID?: string;
  @ApiPropertyOptional({ type: [InboundHeaderDto] })
  @IsOptional() @IsArray() Headers?: InboundHeaderDto[];
}
