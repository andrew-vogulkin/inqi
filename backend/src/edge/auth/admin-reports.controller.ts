import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ReportService } from '../../domain/report/report.service';
import { OrchestratorService } from '../../domain/orchestrator/orchestrator.service';
import { SnapshotsService } from '../../domain/snapshot/snapshots.service';
import { CostService } from '../../infra/usage/cost.service';
import { CreateReportDto } from '../report-dto/create-report.dto';
import { ReportDto, ReportDetailDto } from '../report-dto/report.dto';
import { CostSummaryDto } from './cost.dto';
import { OperatorActionDto, OperationResultDto } from './operator-action.dto';
import { OptionProvenanceDto } from './provenance.dto';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { ApiStandardErrors } from '../../common/errors';

/**
 * Authenticated dashboards (HP-10). Reads are ownership-scoped: a customer sees
 * only their own reports, an admin sees all. Cancel is admin-only.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiStandardErrors(400, 401, 403, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('reports')
export class AdminReportsController {
  constructor(
    private readonly reports: ReportService,
    private readonly orchestrator: OrchestratorService,
    private readonly cost: CostService,
    private readonly snapshots: SnapshotsService,
  ) {}

  // HP-19: intake is authenticated + credit-gated. The owner is the signed-in
  // customer; running reserves the report cost (402 CREDITS_INSUFFICIENT if short).
  @Post()
  @ApiOperation({ summary: 'Submit a new report (authenticated; reserves credits — 402 if insufficient)' })
  @ApiStandardErrors(402)
  @ApiBody({ type: CreateReportDto })
  @ApiCreatedResponse({ type: ReportDto })
  create(@Body() dto: CreateReportDto, @CurrentUser() user: AuthUser) {
    return this.reports.create({ dto, viewer: user });
  }

  @Get()
  @ApiOperation({ summary: 'List reports (own for a customer, all for an admin)' })
  @ApiOkResponse({ type: [ReportDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.reports.list({ viewer: user });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a report with its aggregates (must own it, or be admin)' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: ReportDetailDto })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.reports.get({ id, viewer: user });
  }

  // HP-20: customer-safe provenance for one option (owner or admin). Redacted — no
  // email chain/addresses (the admin dossier keeps using /comms/thread). 404 for non-owners.
  @Get(':id/options/:ref/provenance')
  @ApiOperation({ summary: 'Customer-safe provenance for an option (owner/admin; redacted, no chain)' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiParam({ name: 'ref', description: 'Option ref (the subjectProvider name)', example: 'Acme Trading Co' })
  @ApiOkResponse({ type: OptionProvenanceDto })
  async provenance(@Param('id') id: string, @Param('ref') ref: string, @CurrentUser() user: AuthUser) {
    await this.reports.get({ id, viewer: user }); // owner/admin scope → 404 if not theirs (no existence leak)
    return this.snapshots.provenance({ reportId: id, ref });
  }

  // HP-15: operator-only cost summary (tokens + outreach → $). Never in the customer report.
  @Get(':id/cost')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Per-report cost summary for operators (admin only)' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: CostSummaryDto })
  costSummary(@Param('id') id: string) {
    return this.cost.summaryForReport({ reportId: id });
  }

  // Operator run controls (HP-11), admin-only + audited.
  @Post(':id/cancel')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Cancel an in-flight report (admin only; lands CANCELLED)' })
  @ApiStandardErrors(409)
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiBody({ type: OperatorActionDto })
  @ApiOkResponse({ type: OperationResultDto })
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: OperatorActionDto): Promise<OperationResultDto> {
    const state = await this.orchestrator.cancel({ reportId: id, actor: user.email, reason: body?.reason });
    return { id, state };
  }

  @Post(':id/pause')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Pause an in-flight report (admin only; → ON_HOLD, no new waves released)' })
  @ApiStandardErrors(409)
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiBody({ type: OperatorActionDto })
  @ApiOkResponse({ type: OperationResultDto })
  async pause(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: OperatorActionDto): Promise<OperationResultDto> {
    const state = await this.orchestrator.pause({ reportId: id, actor: user.email, reason: body?.reason });
    return { id, state };
  }

  @Post(':id/resume')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Resume a paused report (admin only; continues from where it left off)' })
  @ApiStandardErrors(409)
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: OperationResultDto })
  async resume(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<OperationResultDto> {
    const state = await this.orchestrator.resume({ reportId: id, actor: user.email });
    return { id, state };
  }
}
