import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DbTx, PrismaService } from '../../infra/persistence/prisma.service';

/** A prior report eligible for reuse (cosine distance, lower = more similar). */
export interface ReusableReport {
  reportId: string;
  token: string;
  distance: number;
}

/** A prior-report candidate with the raw metrics the reuse decision needs. */
export interface ReuseCandidateRow {
  reportId: string;
  token: string;
  /** pgvector cosine distance (lower = more similar). */
  distance: number;
  /** PostGIS distance in meters, or null when either side lacks geo. */
  distanceMeters: number | null;
  /** Age of the prior report in days. */
  ageDays: number;
}

/** Thin data-access for the Subject aggregate. No business rules here. */
@Injectable()
export class SubjectsRepository {
  constructor(private readonly db: PrismaService) {}

  /** Resolve the executor: a passed-in transaction, or the root client (auto-commit). */
  private exec(tx?: DbTx): DbTx {
    return tx ?? this.db;
  }

  create({ data, tx }: { data: Prisma.SubjectUncheckedCreateInput; tx?: DbTx }) {
    return this.exec(tx).subject.create({ data });
  }

  findByInquiry({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).subject.findUnique({ where: { inquiryId } });
  }

  update({ inquiryId, data, tx }: { inquiryId: string; data: Prisma.SubjectUncheckedUpdateInput; tx?: DbTx }) {
    return this.exec(tx).subject.update({ where: { inquiryId }, data });
  }

  /** Confirmed questionnaire answers for enrichment (read-only). */
  async findQuestionnaireAnswers({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }): Promise<Record<string, unknown>> {
    const q = await this.exec(tx).questionnaire.findUnique({ where: { inquiryId } });
    return (q?.answers as Record<string, unknown>) ?? {};
  }

  findInquiryGeo({ inquiryId, tx }: { inquiryId: string; tx?: DbTx }) {
    return this.exec(tx).inquiry.findUnique({ where: { id: inquiryId }, select: { geoLat: true, geoLng: true } });
  }

  /**
   * Store the subject's embedding (pgvector) + geo (PostGIS) — columns added by
   * `prisma/sql/init.sql`, not modeled in Prisma, so written via raw SQL.
   */
  async storeVector({ inquiryId, embedding, lat, lng, tx }: { inquiryId: string; embedding: number[]; lat?: number | null; lng?: number | null; tx?: DbTx }): Promise<void> {
    const db = this.exec(tx);
    const literal = `[${embedding.join(',')}]`;
    await db.$executeRawUnsafe(`UPDATE "Subject" SET embedding = $1::vector WHERE "inquiryId" = $2`, literal, inquiryId);
    if (lat != null && lng != null) {
      await db.$executeRawUnsafe(
        `UPDATE "Subject" SET geo = ST_SetSRID(ST_MakePoint($1,$2),4326)::geography WHERE "inquiryId" = $3`,
        lng, lat, inquiryId,
      );
    }
  }

  /**
   * The nearest prior-report candidates by cosine similarity, each annotated with
   * geo distance (PostGIS, null when geo is absent) + report age. Threshold logic
   * lives in the pure {@link decideReuse} — this just supplies the raw metrics for
   * the top `limit` semantic neighbours.
   */
  async findReusableCandidates({ inquiryId, embedding, lat, lng, limit, tx }: {
    inquiryId: string; embedding: number[]; lat: number | null; lng: number | null; limit: number; tx?: DbTx;
  }): Promise<ReuseCandidateRow[]> {
    const literal = `[${embedding.join(',')}]`;
    const rows = await this.exec(tx).$queryRawUnsafe<Array<{ reportId: string; token: string; distance: number; distanceMeters: number | null; ageDays: number }>>(
      `SELECT r.id AS "reportId", r.token AS token,
              (s.embedding <=> $1::vector) AS distance,
              CASE WHEN s.geo IS NOT NULL AND $4::float8 IS NOT NULL
                   THEN ST_Distance(s.geo, ST_SetSRID(ST_MakePoint($5,$4),4326)::geography)
                   ELSE NULL END AS "distanceMeters",
              EXTRACT(EPOCH FROM (now() - r."createdAt")) / 86400.0 AS "ageDays"
       FROM "Subject" s
       JOIN "Report" r ON r."inquiryId" = s."inquiryId"
       WHERE s."inquiryId" <> $2
         AND s.embedding IS NOT NULL
       ORDER BY distance ASC
       LIMIT $3`,
      literal, inquiryId, limit, lat, lng,
    );
    return rows.map((r) => ({
      reportId: r.reportId,
      token: r.token,
      distance: Number(r.distance),
      distanceMeters: r.distanceMeters == null ? null : Number(r.distanceMeters),
      ageDays: Number(r.ageDays),
    }));
  }
}
