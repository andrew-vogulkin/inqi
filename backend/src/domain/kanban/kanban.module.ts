import { Module } from '@nestjs/common';
import { KanbanService } from './kanban.service';

/** Domain: read/projection over epics+subtasks (CQRS query side). */
@Module({
  providers: [KanbanService],
  exports: [KanbanService],
})
export class KanbanModule {}
