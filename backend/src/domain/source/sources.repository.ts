import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConvState, SourceType } from '@inqi/shared';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** Thin data-access for Source rows (typed channel records under an Inquiry). */
@Injectable()
export class SourcesRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  /** Upsert one flat (non-thread) source row, deduped on (inquiryId, type, url). */
  upsertFlat({ inquiryId, type, url, title, snippet, data, tx }: {
    inquiryId: string; type: SourceType; url: string; title?: string | null; snippet?: string | null;
    data?: Prisma.InputJsonValue; tx?: DbTx;
  }) {
    return this.exec(tx).source.upsert({
      where: { inquiryId_type_url: { inquiryId, type, url } },
      create: { inquiryId, type, url, title, snippet, data: data ?? {} },
      update: { ...(title ? { title } : {}), ...(snippet ? { snippet } : {}), ...(data ? { data } : {}) },
    });
  }

  /**
   * The thread source of `type` for an inquiry, if any. `channel` narrows to one
   * named thread (an inquiry can hold several email threads — sales, booking, …);
   * without it the first thread wins (single-thread inquiries, back-compat).
   */
  findThread({ inquiryId, type, channel, tx }: { inquiryId: string; type: SourceType; channel?: string; tx?: DbTx }) {
    return this.exec(tx).source.findFirst({
      where: { inquiryId, type, ...(channel ? { data: { path: ['channel'], equals: channel } } : {}) },
      orderBy: { createdAt: 'asc' },
    });
  }

  createThread({ inquiryId, type, replyAddress, convState, channel, tx }: {
    inquiryId: string; type: SourceType; replyAddress: string; convState: string; channel?: string; tx?: DbTx;
  }) {
    return this.exec(tx).source.create({ data: { inquiryId, type, replyAddress, convState, ...(channel ? { data: { channel } } : {}) } });
  }

  updateThreadState({ sourceId, convState, lastInboundAt, tx }: {
    sourceId: string; convState?: string; lastInboundAt?: Date; tx?: DbTx;
  }) {
    return this.exec(tx).source.update({
      where: { id: sourceId },
      data: { ...(convState ? { convState } : {}), ...(lastInboundAt ? { lastInboundAt } : {}) },
    });
  }

  findById({ id, tx }: { id: string; tx?: DbTx }) {
    return this.exec(tx).source.findUnique({ where: { id } });
  }

  /** Quarantine a thread: closed + marked blocked (compliance) — outreach never resumes on it. */
  async blockThread({ sourceId, reason, tx }: { sourceId: string; reason: string; tx?: DbTx }) {
    const src = await this.exec(tx).source.findUnique({ where: { id: sourceId }, select: { data: true } });
    const data = { ...((src?.data as Record<string, unknown>) ?? {}), blocked: true, blockedReason: reason };
    return this.exec(tx).source.update({ where: { id: sourceId }, data: { convState: ConvState.Closed, data } });
  }

  /** Resolve an inbound reply address back to its thread source + owning inquiry. */
  findThreadByReplyAddress({ replyAddress, tx }: { replyAddress: string; tx?: DbTx }) {
    return this.exec(tx).source.findUnique({
      where: { replyAddress },
      include: { inquiry: { select: { id: true, reportId: true, epicId: true, name: true } } },
    });
  }

  listByInquiry({ inquiryId, type, tx }: { inquiryId: string; type?: SourceType; tx?: DbTx }) {
    return this.exec(tx).source.findMany({
      where: { inquiryId, ...(type ? { type } : {}) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** All sources under a report, newest first per inquiry (context assembly + admin views). */
  listByReport({ reportId, tx }: { reportId: string; tx?: DbTx }) {
    return this.exec(tx).source.findMany({
      where: { inquiry: { reportId } },
      orderBy: { createdAt: 'desc' },
    });
  }
}
