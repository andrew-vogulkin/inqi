import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkflowAdminService } from '../../domain/orchestrator/workflow-admin.service';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { WorkflowInspectDto, WorkflowVersionDto } from './workflow.dto';

/** Admin-only workflow-version management (HP-12): list / inspect / diff / publish. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List workflow versions (key, version, status, pinned-inquiry counts)' })
  @ApiOkResponse({ type: [WorkflowVersionDto] })
  list() {
    return this.workflows.list();
  }

  @Get(':id')
  @ApiOperation({ summary: "Inspect a version's states + transitions (+ graph validation)" })
  @ApiOkResponse({ type: WorkflowInspectDto })
  inspect(@Param('id') id: string) {
    return this.workflows.inspect({ id });
  }

  @Get(':id/diff')
  @ApiOperation({ summary: 'Diff a version against the current active version of its key' })
  diff(@Param('id') id: string) {
    return this.workflows.diff({ id });
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Activate a version (validate graph → draft→active, previous active→archived); audited' })
  publish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.workflows.publish({ id, actor: user.email });
  }
}
