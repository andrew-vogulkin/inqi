import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WorkflowAdminService } from '../../domain/orchestrator/workflow-admin.service';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { WorkflowDiffDto, WorkflowInspectDto, WorkflowPublishResultDto, WorkflowVersionDto } from './workflow.dto';
import { ApiStandardErrors } from '../../common/errors';

/** Admin-only workflow-version management (HP-12): list / inspect / diff / publish. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(401, 403, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflows: WorkflowAdminService) {}

  @Get()
  @ApiOperation({ summary: 'List workflow versions (key, version, status, pinned-report counts)' })
  @ApiOkResponse({ type: [WorkflowVersionDto] })
  list() {
    return this.workflows.list();
  }

  @Get(':id')
  @ApiOperation({ summary: "Inspect a version's states + transitions (+ graph validation)" })
  @ApiParam({ name: 'id', description: 'Workflow version id', example: 'clz1wf0001' })
  @ApiOkResponse({ type: WorkflowInspectDto })
  inspect(@Param('id') id: string) {
    return this.workflows.inspect({ id });
  }

  @Get(':id/diff')
  @ApiOperation({ summary: 'Diff a version against the current active version of its key' })
  @ApiParam({ name: 'id', description: 'Workflow version id to diff', example: 'clz1wf0001' })
  @ApiOkResponse({ type: WorkflowDiffDto })
  diff(@Param('id') id: string) {
    return this.workflows.diff({ id });
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Activate a version (validate graph → draft→active, previous active→archived); audited' })
  @ApiParam({ name: 'id', description: 'Workflow version id to activate', example: 'clz1wf0001' })
  @ApiOkResponse({ type: WorkflowPublishResultDto })
  publish(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.workflows.publish({ id, actor: user.email });
  }
}
