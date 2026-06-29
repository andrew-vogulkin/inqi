import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CreditsService } from '../../domain/credits/credits.service';
import { AuthGuard } from './auth.guard';
import { AdminGuard } from './admin.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { CreditBalanceDto, CustomerDirectoryDto, TopUpDto, TopUpResultDto } from './credits.dto';

/** Customer-facing credits (HP-19): the signed-in customer's balance + history. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AuthGuard)
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
}

/** Admin manual top-up (HP-19): admin-gated + audited. */
@ApiTags('auth')
@ApiBearerAuth()
@UseGuards(AdminGuard)
@Controller('admin/customers')
export class AdminCustomersController {
  constructor(private readonly credits: CreditsService) {}

  // HP-22: customer directory/search so an operator can find a customer before a top-up.
  @Get()
  @ApiOperation({ summary: 'Search customers by name / email / id (admin only)' })
  @ApiQuery({ name: 'q', required: false, description: 'Search term (empty → [])' })
  @ApiOkResponse({ type: [CustomerDirectoryDto] })
  search(@Query('q') q?: string): Promise<CustomerDirectoryDto[]> {
    return this.credits.searchCustomers({ q: q ?? '' });
  }

  @Post(':id/credits')
  @ApiOperation({ summary: 'Grant credits to a customer (admin only; audited)' })
  @ApiOkResponse({ type: TopUpResultDto })
  topUp(@Param('id') id: string, @Body() dto: TopUpDto, @CurrentUser() user: AuthUser): Promise<TopUpResultDto> {
    return this.credits.topUp({ customerId: id, amount: dto.amount, note: dto.note, actor: user.email });
  }
}
