import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { ReportsService } from '../../domain/reports/reports.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { UnlockResultDto } from './report-extra.dto';

/** Authenticated report actions (HP-21): the freemium unlock charge (owner-gated). */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('reports')
export class AuthedReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post(':id/unlock')
  @ApiOperation({ summary: 'Unlock a freemium report (owner; charges 1 credit; 402 if none; idempotent)' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1rep0000xy' })
  @ApiOkResponse({ type: UnlockResultDto })
  unlock(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<UnlockResultDto> {
    return this.reports.unlock({ reportId: id, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
