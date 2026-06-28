import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionnaireService } from './questionnaire.service';
import { QuestionnaireController } from './questionnaire.controller';

@Module({ controllers: [QuestionnaireController], providers: [PrismaService, QuestionnaireService], exports: [QuestionnaireService] })
export class QuestionnaireModule {}
