import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { QuestionnaireService } from '../../domain/questionnaire/questionnaire.service';
import { QuestionnaireAnswersDto, QuestionnaireDto, SubmitResultDto } from './questionnaire-dto/questionnaire.dto';

/** Capability-token surface: fill the questionnaire via the tokened link (no login). */
@ApiTags('capability-token')
@Controller('q')
export class QuestionnaireController {
  constructor(private readonly questionnaire: QuestionnaireService) {}

  @Get(':token')
  @ApiOperation({ summary: 'Fetch the questionnaire for a token' })
  @ApiOkResponse({ type: QuestionnaireDto })
  get(@Param('token') token: string) {
    return this.questionnaire.getByToken({ token });
  }

  @Post(':token')
  @ApiOperation({ summary: 'Submit questionnaire answers (confirms the subject)' })
  @ApiOkResponse({ type: SubmitResultDto })
  submit(@Param('token') token: string, @Body() answers: QuestionnaireAnswersDto) {
    return this.questionnaire.submit({ token, answers });
  }
}
