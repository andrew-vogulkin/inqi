import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { QuestionnaireService } from '../../domain/questionnaire/questionnaire.service';
import { QuestionnaireAnswersDto, QuestionnaireDto, SubmitResultDto } from './questionnaire-dto/questionnaire.dto';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AuthUser } from '../auth/auth.tokens';

/** Questionnaire by token. HP-24: authenticated + owner-scoped (token = resource id within owner scope). */
@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('q')
export class QuestionnaireController {
  constructor(private readonly questionnaire: QuestionnaireService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Fetch the questionnaire for a token (owner/admin only)' })
  @ApiParam({ name: 'token', description: 'Questionnaire capability token', example: 'a1b2c3d4e5f6a1b2c3d4e5f6' })
  @ApiOkResponse({ type: QuestionnaireDto })
  get(@Param('token') token: string, @CurrentUser() user: AuthUser) {
    return this.questionnaire.getByToken({ token, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }

  @Post(':token')
  @ApiOperation({ summary: 'Submit questionnaire answers (confirms the subject; owner/admin only)' })
  @ApiParam({ name: 'token', description: 'Questionnaire capability token', example: 'a1b2c3d4e5f6a1b2c3d4e5f6' })
  @ApiOkResponse({ type: SubmitResultDto })
  submit(@Param('token') token: string, @Body() answers: QuestionnaireAnswersDto, @CurrentUser() user: AuthUser) {
    return this.questionnaire.submit({ token, answers, viewer: { sub: user.sub, email: user.email, role: user.role } });
  }
}
