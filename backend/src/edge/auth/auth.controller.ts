import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { EmailStartDto, EmailStartResultDto, EmailVerifyDto, MeDto, SessionDto } from './auth.dto';
import { ApiStandardErrors } from '../../common/errors';

/** Public two-step email sign-in (email → MFA code) + current-session read. */
@ApiTags('auth')
@ApiStandardErrors(400, 401) // every endpoint here can return these (ErrorEnvelope)
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('email')
  @ApiOperation({ summary: 'Step 1 — request a verification code for this email (mock transport: code 123456; email transport sends a one-time code)' })
  @ApiBody({ type: EmailStartDto })
  @ApiCreatedResponse({ type: EmailStartResultDto })
  start(@Body() dto: EmailStartDto): Promise<EmailStartResultDto> {
    return this.auth.startEmailSignIn({ email: dto.email });
  }

  @Post('email/verify')
  @ApiOperation({ summary: 'Step 2 — verify the code, link the Customer, issue a session' })
  @ApiBody({ type: EmailVerifyDto })
  @ApiCreatedResponse({ type: SessionDto })
  verify(@Body() dto: EmailVerifyDto) {
    return this.auth.verifyEmailSignIn({ email: dto.email, code: dto.code });
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'The current authenticated principal' })
  @ApiOkResponse({ type: MeDto })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me({ user });
  }
}
