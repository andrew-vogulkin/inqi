import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { InquiryService } from '../../domain/inquiry/inquiry.service';
import { OrchestratorService } from '../../domain/orchestrator/orchestrator.service';
import { InquiryDto, InquiryDetailDto } from '../inquiry-dto/inquiry.dto';
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
  ) {}

  @Get()
  @ApiOperation({ summary: 'List inquiries (own for a customer, all for an admin)' })
  @ApiOkResponse({ type: [InquiryDto] })
  list(@CurrentUser() user: AuthUser) {
    return this.inquiries.list({ viewer: user });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an inquiry with its aggregates (must own it, or be admin)' })
  @ApiOkResponse({ type: InquiryDetailDto })
  get(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.inquiries.get({ id, viewer: user });
  }

  // HP-09 cancel seam, admin-only (HP-11 expands operator controls to pause/resume).
  @Post(':id/cancel')
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: 'Cancel an in-flight inquiry (admin only; lands CANCELLED)' })
  async cancel(@Param('id') id: string) {
    const state = await this.orchestrator.cancel({ inquiryId: id });
    return { id, state };
  }
}
