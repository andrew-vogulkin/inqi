import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SourceType } from '@inqi/shared';
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

  /** The (single) thread source of `type` for an inquiry, if any. */
  findThread({ inquiryId, type, tx }: { inquiryId: string; type: SourceType; tx?: DbTx }) {
    return this.exec(tx).source.findFirst({ where: { inquiryId, type } });
  }

  createThread({ inquiryId, type, replyAddress, convState, tx }: {
    inquiryId: string; type: SourceType; replyAddress: string; convState: string; tx?: DbTx;
  }) {
    return this.exec(tx).source.create({ data: { inquiryId, type, replyAddress, convState } });
  }

  updateThreadState({ sourceId, convState, lastInboundAt, tx }: {
    sourceId: string; convState?: string; lastInboundAt?: Date; tx?: DbTx;
  }) {
    return this.exec(tx).source.update({
      where: { id: sourceId },
      data: { ...(convState ? { convState } : {}), ...(lastInboundAt ? { lastInboundAt } : {}) },
    });
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
