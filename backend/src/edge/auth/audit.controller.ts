import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuditEntryType } from '@inqi/shared';
import { AuditQueryService } from '../../infra/observability/audit-query.service';
import { AdminGuard } from './admin.guard';
import { AuditQueryDto, AuditResultDto } from './audit.dto';
import { ApiStandardErrors } from '../../common/errors';

/** Admin-only, read-only audit trail (HP-14): denials, compliance blocks, agent + operator actions, transitions. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403) // every endpoint here can return these (ErrorEnvelope)
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditQueryService) {}

  @Get()
  @ApiOperation({ summary: 'Query the audit trail (by report, type, time range; paginated)' })
  @ApiOkResponse({ type: AuditResultDto })
  query(@Query() q: AuditQueryDto) {
    const types = q.types ? (q.types.split(',').map((t) => t.trim()).filter(Boolean) as AuditEntryType[]) : undefined;
    return this.audit.query({ reportId: q.reportId, types, from: q.from, to: q.to, limit: q.limit, offset: q.offset });
  }
}
