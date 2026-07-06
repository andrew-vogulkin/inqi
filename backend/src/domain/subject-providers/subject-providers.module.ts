import { Module } from '@nestjs/common';
import { SourcesModule } from '../source/sources.module';
import { SubjectProvidersService } from './subject-providers.service';
import { SubjectProvidersRepository } from './subject-providers.repository';
import { BACKGROUND_RESEARCH_SOURCE } from './background.tokens';
import { StubBackgroundResearchSource } from './ratings-source.provider';

/**
 * Domain: subject-provider background/quality research collaborators. Discovery
 * and the depth loop themselves are the breadth_search / depth_search workflow
 * types (domain/phases) — this module provides what their step handlers share:
 * the agent tool set, run context, verdict persistence + settlement, fallbacks.
 */
@Module({
  imports: [SourcesModule],
  providers: [
    SubjectProvidersService,
    SubjectProvidersRepository,
    { provide: BACKGROUND_RESEARCH_SOURCE, useClass: StubBackgroundResearchSource },
  ],
  exports: [SubjectProvidersService, SubjectProvidersRepository],
})
export class SubjectProvidersModule {}
