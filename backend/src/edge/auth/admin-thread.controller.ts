import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { KanbanService } from '../../domain/kanban/kanban.service';
import { MessageDto } from '../message-dto/message.dto';
import { AdminGuard } from './admin.guard';

/** Admin-only read of a subtask's full email thread (internal operator view). */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('comms')
export class AdminThreadController {
  constructor(private readonly kanban: KanbanService) {}

  @Get('thread/:subtaskId')
  @ApiOperation({ summary: 'Get the full email thread for a subtask' })
  @ApiOkResponse({ type: [MessageDto] })
  thread(@Param('subtaskId') subtaskId: string) {
    return this.kanban.thread({ subtaskId });
  }
}
