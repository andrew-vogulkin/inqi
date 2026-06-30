import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { InquiryService } from '../../domain/inquiry/inquiry.service';
import { OrchestratorService } from '../../domain/orchestrator/orchestrator.service';
import { ReportsService } from '../../domain/reports/reports.service';
import { CostService } from '../../infra/usage/cost.service';
import { CreateInquiryDto } from '../inquiry-dto/create-inquiry.dto';
import { InquiryDto, InquiryDetailDto } from '../inquiry-dto/inquiry.dto';
import { CostSummaryDto } from './cost.dto';
import { OperatorActionDto, OperationResultDto } from './operator-action.dto';
import { OptionProvenanceDto } from './provenance.dto';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';

/**
 * Authenticated dashboards (HP-10). Reads are ownership-scoped: a customer sees
 * only their own inquiries, an admin sees all. Cancel is admin-only.
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('inquiries')
export class AdminInquiriesController {
  constructor(
    private readonly inquiries: InquiryService,
    private readonly orchestrator: OrchestratorService,
    private readonly cost: CostService,
    private readonly reports: ReportsService,
  ) {}

  // HP-19: intake is authenticated + credit-gated. The owner is the signed-in
  // customer; running reserves the report cost (402 CREDITS_INSUFFICIENT if short).
  @Post()
  @ApiOperation({ summary: 'Submit a new inquiry (authenticated; reserves credits — 402 if insufficient)' })
  @ApiCreatedResponse({ type: InquiryDto })
  create(@Body() dto: CreateInquiryDto, @CurrentUser() user: AuthUser) {
    return this.inquiries.create({ dto, viewer: user });
  }

  @Get()
  @ApiOperation({ summary: 'List inquiries (own for a customer, all for an admin)' })
  @ApiOkResponse({ type: [InquiryDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.inquiries.list({ viewer: user });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an inquiry with its aggregates (must own it, or be admin)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: InquiryDetailDto })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.get({ id, viewer: user });
  }

  // HP-20: customer-safe provenance for one option (owner or admin). Redacted — no
  // email chain/addresses (the admin dossier keeps using /comms/thread). 404 for non-owners.
  @Get(':id/options/:ref/provenance')
  @ApiOperation({ summary: 'Customer-safe provenance for an option (owner/admin; redacted, no chain)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiParam({ name: 'ref', description: 'Option ref (the subjectProvider name)', example: 'Acme Trading Co' })
  @ApiOkResponse({ type: OptionProvenanceDto })
  async provenance(@Param('id') id: string, @Param('ref') ref: string, @CurrentUser() user: AuthUser) {
    await this.inquiries.get({ id, viewer: user }); // owner/admin scope → 404 if not theirs (no existence leak)
    return this.reports.provenance({ inquiryId: id, ref });
  }

  // HP-15: operator-only cost summary (tokens + outreach → $). Never in the customer report.
  @Get(':id/cost')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Per-inquiry cost summary for operators (admin only)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: CostSummaryDto })
  costSummary(@Param('id') id: string) {
    return this.cost.summaryForInquiry({ inquiryId: id });
  }

  // Operator run controls (HP-11), admin-only + audited.
  @Post(':id/cancel')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Cancel an in-flight inquiry (admin only; lands CANCELLED)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: OperationResultDto })
  async cancel(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: OperatorActionDto): Promise<OperationResultDto> {
    const state = await this.orchestrator.cancel({ inquiryId: id, actor: user.email, reason: body?.reason });
    return { id, state };
  }

  @Post(':id/pause')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Pause an in-flight inquiry (admin only; → ON_HOLD, no new waves released)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: OperationResultDto })
  async pause(@Param('id') id: string, @CurrentUser() user: AuthUser, @Body() body: OperatorActionDto): Promise<OperationResultDto> {
    const state = await this.orchestrator.pause({ inquiryId: id, actor: user.email, reason: body?.reason });
    return { id, state };
  }

  @Post(':id/resume')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Resume a paused inquiry (admin only; continues from where it left off)' })
  @ApiParam({ name: 'id', description: 'Inquiry id', example: 'clz1abcd0000xy' })
  @ApiOkResponse({ type: OperationResultDto })
  async resume(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<OperationResultDto> {
    const state = await this.orchestrator.resume({ inquiryId: id, actor: user.email });
    return { id, state };
  }
}
