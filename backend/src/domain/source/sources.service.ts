import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { Prisma, Source } from '@prisma/client';
import { ConvState, EventType, SourceType } from '@inqi/shared';
import { ConfigService } from '../../infra/config/config.service';
import { OutboxService } from '../../infra/events/outbox.service';
import { DbTx } from '../../infra/persistence/prisma.service';
import { SourcesRepository } from './sources.repository';

export interface FlatSourceInput {
  url: string;
  title?: string | null;
  snippet?: string | null;
  data?: Prisma.InputJsonValue;
}

/**
 * The Source layer: every channel touchpoint of an Inquiry is one typed Source
 * row (SourceType). Flat channels (websearch, rating_feedback) are upserted,
 * deduped per (inquiry, type, url); thread channels (email, whatsapp) anchor a
 * conversation — they own the reply address, conversation state and Messages.
 * All per-channel logic lives here; the Report layer only consumes Inquiries.
 */
@Injectable()
export class SourcesService {
  constructor(
    private readonly sources: SourcesRepository,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService,
  ) {}

  /** Record web pages consulted for an inquiry (discovery evidence, background research). */
  async addWebsearch({ reportId, inquiryId, results, tx }: { reportId: string; inquiryId: string; results: FlatSourceInput[]; tx?: DbTx }): Promise<Source[]> {
    return this.addFlat({ reportId, inquiryId, type: SourceType.Websearch, entries: results, tx });
  }

  /** Record ratings/feedback digests (external review sources) for an inquiry. */
  async addRatingFeedback({ reportId, inquiryId, entries, tx }: { reportId: string; inquiryId: string; entries: FlatSourceInput[]; tx?: DbTx }): Promise<Source[]> {
    return this.addFlat({ reportId, inquiryId, type: SourceType.RatingFeedback, entries, tx });
  }

  private async addFlat({ reportId, inquiryId, type, entries, tx }: { reportId: string; inquiryId: string; type: SourceType; entries: FlatSourceInput[]; tx?: DbTx }): Promise<Source[]> {
    if (!entries.length) return [];
    const rows: Source[] = [];
    for (const e of entries) {
      rows.push(await this.sources.upsertFlat({ inquiryId, type, url: e.url, title: e.title, snippet: e.snippet, data: e.data, tx }));
    }
    // The event carries the rows (SourceDto shape) so the admin board can append live without a refetch.
    const sources = rows.map((r) => ({ id: r.id, inquiryId: r.inquiryId, type: r.type, url: r.url, title: r.title, snippet: r.snippet, createdAt: r.createdAt.toISOString() }));
    await this.outbox.emit({ type: EventType.SourceAdded, reportId, inquiryId, data: { inquiryId, type, count: rows.length, sources }, tx });
    return rows;
  }

  /**
   * The email-thread anchor for an inquiry: one Source of type `email` carrying
   * the unique reply address + conversation state. Idempotent — a retried send
   * reuses the existing thread (and its original reply address).
   */
  async ensureEmailThread({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }): Promise<Source> {
    const existing = await this.sources.findThread({ inquiryId, type: SourceType.Email, tx });
    if (existing) return existing;
    const token = randomBytes(16).toString('hex');
    return this.sources.createThread({
      inquiryId, type: SourceType.Email,
      replyAddress: `${token}@${this.config.inboundDomain}`,
      convState: ConvState.Idle,
      tx,
    });
  }

  /** The existing email thread of an inquiry, if any (no create). */
  findEmailThread({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }): ReturnType<SourcesRepository['findThread']> {
    return this.sources.findThread({ inquiryId, type: SourceType.Email, tx });
  }

  /** Conversation-state bookkeeping on a thread source (agent reply loop). */
  updateThreadState({ sourceId, convState, lastInboundAt, tx }: { sourceId: string; convState?: ConvState; lastInboundAt?: Date; tx?: DbTx }): ReturnType<SourcesRepository['updateThreadState']> {
    return this.sources.updateThreadState({ sourceId, convState, lastInboundAt, tx });
  }

  /** Map an inbound reply address to its thread source + owning inquiry (webhook ingress). */
  findThreadByReplyAddress({ replyAddress, tx }: { replyAddress: string; tx?: DbTx }): ReturnType<SourcesRepository['findThreadByReplyAddress']> {
    return this.sources.findThreadByReplyAddress({ replyAddress, tx });
  }

  listByInquiry({ inquiryId, type, tx }: { inquiryId: string; type?: SourceType; tx?: DbTx }): ReturnType<SourcesRepository['listByInquiry']> {
    return this.sources.listByInquiry({ inquiryId, type, tx });
  }

  listByReport({ reportId, tx }: { reportId: string; tx?: DbTx }): ReturnType<SourcesRepository['listByReport']> {
    return this.sources.listByReport({ reportId, tx });
  }
}
