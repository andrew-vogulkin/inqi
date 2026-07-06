import { Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { SnapshotsService } from '../../domain/snapshot/snapshots.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { UnlockResultDto } from './report-extra.dto';
import { ApiStandardErrors } from '../../common/errors';

/** Authenticated report actions (HP-21): the freemium unlock charge (owner-gated). */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiStandardErrors(401, 402, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('snapshots')
export class AuthedSnapshotsController {
  constructor(private readonly reports: SnapshotsService) {}

  @Post(':id/unlock')
  @ApiOperation({ summary: 'Unlock a freemium report (owner; charges 1 credit; 402 if none; idempotent)' })
  @ApiParam({ name: 'id', description: 'Report id', example: 'clz1rep0000xy' })
  @ApiOkResponse({ type: UnlockResultDto })
  unlock(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<UnlockResultDto> {
    return this.reports.unlock({ snapshotId: id, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
