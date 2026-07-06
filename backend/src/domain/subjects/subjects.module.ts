import { Module } from '@nestjs/common';
import { SubjectsService } from './subjects.service';
import { SubjectsRepository } from './subjects.repository';

/** Domain: subject enrichment + prior-report reuse. */
@Module({
  providers: [SubjectsService, SubjectsRepository],
  exports: [SubjectsService],
})
export class SubjectsModule {}
