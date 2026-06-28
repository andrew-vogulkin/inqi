import { Module } from '@nestjs/common';
import { SubjectProvidersService } from './subject-providers.service';
import { SubjectProvidersRepository } from './subject-providers.repository';
import { BACKGROUND_RESEARCH_SOURCE } from './background.tokens';
import { StubBackgroundResearchSource } from './ratings-source.provider';
import { DISCOVERY_SOURCE } from './discovery.tokens';
import { AiDiscoverySource } from './ai-discovery.source';

/** Domain: subject-provider discovery + background/quality research. */
@Module({
  providers: [
    SubjectProvidersService,
    SubjectProvidersRepository,
    { provide: BACKGROUND_RESEARCH_SOURCE, useClass: StubBackgroundResearchSource },
    { provide: DISCOVERY_SOURCE, useClass: AiDiscoverySource },
  ],
  exports: [SubjectProvidersService],
})
export class SubjectProvidersModule {}
