import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthGuard } from './auth.guard';
import { CurrentUser } from './current-user.decorator';
import { AuthUser } from './auth.tokens';
import { GoogleSignInDto, MeDto, SessionDto } from './auth.dto';

/** Public sign-in + current-session read. Sign in with Google (HP-10). */
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('google')
  @ApiOperation({ summary: 'Sign in with Google (verify ID token, link Customer, issue session)' })
  @ApiCreatedResponse({ type: SessionDto })
  google(@Body() dto: GoogleSignInDto) {
    return this.auth.signInWithGoogle({ idToken: dto.idToken });
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
