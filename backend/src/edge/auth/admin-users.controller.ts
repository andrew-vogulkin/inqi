import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CustomerService } from '../../domain/customer/customer.service';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { SuspendUserDto, UserRowDto, UserSearchQueryDto, UserSearchResultDto } from './user-admin.dto';
import { ApiStandardErrors } from '../../common/errors';

/**
 * HP-25 — admin user directory: browse every account (alphabetical by email,
 * cursor-paginated), then suspend / reactivate one. Admin-gated + audited; the
 * suspension is enforced at the auth layer (sign-in refused, live sessions rejected).
 */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('admin/users')
export class AdminUsersController {
  constructor(private readonly customers: CustomerService) {}

  @Get()
  @ApiOperation({ summary: 'List accounts (email A→Z; filter by q/status; cursor-paginated)' })
  @ApiOkResponse({ type: UserSearchResultDto })
  list(@Query() query: UserSearchQueryDto): Promise<UserSearchResultDto> {
    return this.customers.listUsers({ q: query.q, status: query.status, limit: query.limit, cursor: query.cursor });
  }

  @Post(':id/suspend')
  @ApiOperation({ summary: 'Suspend a customer account (audited; blocks sign-in + live sessions). Cannot target yourself or another admin.' })
  @ApiParam({ name: 'id', description: 'Customer id', example: 'clz1cust0000xy' })
  @ApiBody({ type: SuspendUserDto })
  @ApiOkResponse({ type: UserRowDto })
  suspend(@Param('id') id: string, @Body() dto: SuspendUserDto, @CurrentUser() user: AuthUser): Promise<UserRowDto> {
    return this.customers.suspend({ id, reason: dto.reason, actorId: user.sub, actorEmail: user.email });
  }

  @Post(':id/reactivate')
  @ApiOperation({ summary: 'Lift a suspension (audited)' })
  @ApiParam({ name: 'id', description: 'Customer id', example: 'clz1cust0000xy' })
  @ApiOkResponse({ type: UserRowDto })
  reactivate(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<UserRowDto> {
    return this.customers.reactivate({ id, actorEmail: user.email });
  }
}
