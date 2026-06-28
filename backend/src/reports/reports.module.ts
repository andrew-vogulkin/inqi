import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ReportsController } from './reports.controller';
@Module({ controllers: [ReportsController], providers: [PrismaService] })
export class ReportsModule {}
