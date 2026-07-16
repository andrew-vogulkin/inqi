import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreditsService } from '../../domain/credits/credits.service';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { ApproveCreditRequestDto, CreateCreditRequestDto, CreditBalanceDto, CreditRequestDto, CustomerDirectoryDto, TopUpDto, TopUpResultDto } from './credits.dto';
import { ApiStandardErrors } from '../../common/errors';

/** Customer-facing credits (HP-19): the signed-in customer's balance + history. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiStandardErrors(401) // every endpoint here can return these (ErrorEnvelope)
@Controller('me')
export class MeCreditsController {
  constructor(private readonly credits: CreditsService) {}

  @Get('credits')
  @ApiOperation({ summary: 'My credit balance + recent ledger history' })
  @ApiOkResponse({ type: CreditBalanceDto })
  async myCredits(@CurrentUser() user: AuthUser): Promise<CreditBalanceDto> {
    const [balance, history] = await Promise.all([
      this.credits.balance({ customerId: user.sub }),
      this.credits.history({ customerId: user.sub }),
    ]);
    return { balance, history };
  }

  @Post('credits/requests')
  @ApiOperation({ summary: 'Request a credit top-up (an operator approves or rejects it)' })
  @ApiBody({ type: CreateCreditRequestDto })
  @ApiCreatedResponse({ schema: { properties: { id: { type: 'string', example: 'clz...' } } } })
  requestTopUp(@Body() dto: CreateCreditRequestDto, @CurrentUser() user: AuthUser): Promise<{ id: string }> {
    return this.credits.requestTopUp({ customerId: user.sub, amount: dto.amount, note: dto.note });
  }
}

/** Admin credit-request queue (HP-19): list pending, approve (→ grant), or reject. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403, 404)
@Controller('admin/credit-requests')
export class AdminCreditRequestsController {
  constructor(private readonly credits: CreditsService) {}

  @Get()
  @ApiOperation({ summary: 'Pending credit requests (operator queue)' })
  @ApiOkResponse({ type: [CreditRequestDto] })
  list(): Promise<CreditRequestDto[]> {
    return this.credits.listPendingRequests();
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Approve a credit request → grant credits (amount overridable; audited; emails the customer)' })
  @ApiParam({ name: 'id', description: 'Credit request id', example: 'clz...' })
  @ApiBody({ type: ApproveCreditRequestDto, required: false })
  @ApiOkResponse({ type: TopUpResultDto })
  approve(@Param('id') id: string, @Body() dto: ApproveCreditRequestDto, @CurrentUser() user: AuthUser) {
    return this.credits.approveRequest({ requestId: id, actorId: user.sub, actorEmail: user.email, amount: dto.amount });
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject a credit request (no grant)' })
  @ApiParam({ name: 'id', description: 'Credit request id', example: 'clz...' })
  reject(@Param('id') id: string, @CurrentUser() user: AuthUser): Promise<void> {
    return this.credits.rejectRequest({ requestId: id, actorId: user.sub, actorEmail: user.email });
  }
}

/** Admin manual top-up (HP-19): admin-gated + audited. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@ApiStandardErrors(400, 401, 403, 404) // every endpoint here can return these (ErrorEnvelope)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly credits: CreditsService) {}

  // HP-22: customer directory/search so an operator can find a customer before a top-up.
  @Get()
  @ApiOperation({ summary: 'Search customers by name / email / id (admin only)' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term (empty → [])', example: 'ada@example.com' })
  @ApiOkResponse({ type: [CustomerDirectoryDto] })
  search(@Query('q') q?: string): Promise<CustomerDirectoryDto[]> {
    return this.credits.searchCustomers({ q: q ?? '' });
  }

  @Post(':id/credits')
  @ApiOperation({ summary: 'Grant credits to a customer (admin only; audited)' })
  @ApiParam({ name: 'id', description: 'Customer id', example: 'clz1cust0000xy' })
  @ApiBody({ type: TopUpDto })
  @ApiOkResponse({ type: TopUpResultDto })
  topUp(@Param('id') id: string, @Body() dto: TopUpDto, @CurrentUser() user: AuthUser): Promise<TopUpResultDto> {
    return this.credits.topUp({ customerId: id, amount: dto.amount, note: dto.note, actor: user.email });
  }
}
