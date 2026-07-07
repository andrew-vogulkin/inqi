import { Module } from '@nestjs/common';
import { SubjectBuildProposerService } from './subject-build-proposer.service';

/**
 * The subject_build self-improvement worker: ~5% of deliveries enqueue a proposal
 * (rolled in the workflow engine) that composes + rehearses a candidate composition
 * and drafts a winner for operator review. AI / Prisma / Boss are @Global.
 */
@Module({ providers: [SubjectBuildProposerService] })
export class SubjectBuildModule {}
