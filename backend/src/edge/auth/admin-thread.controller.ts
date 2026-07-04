import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { KanbanService } from '../../domain/kanban/kanban.service';
import { MessageDto } from '../message-dto/message.dto';
import { AdminGuard } from './admin.guard';
import { ApiStandardErrors } from '../../common/errors';

/** Admin-only read of an inquiry's full email thread (internal operator view). */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(401, 403, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('comms')
export class AdminThreadController {
  constructor(private readonly kanban: KanbanService) {}

  @Get('thread/:inquiryId')
  @ApiOperation({ summary: 'Get the full email thread for an inquiry' })
  @ApiParam({ name: 'inquiryId', description: 'Inquiry id', example: 'clz1sub0000xy' })
  @ApiOkResponse({ type: [MessageDto] })
  thread(@Param('inquiryId') inquiryId: string) {
    return this.kanban.thread({ inquiryId });
  }
}
