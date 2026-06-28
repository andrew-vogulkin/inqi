import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { QuestionnaireService } from './questionnaire.service';

@Controller('q')
export class QuestionnaireController {
  constructor(private svc: QuestionnaireService) {}
  @Get(':token') get(@Param('token') t: string) { return this.svc.getByToken(t); }
  @Post(':token') submit(@Param('token') t: string, @Body() dto: any) { return this.svc.submit(t, dto); }
}
