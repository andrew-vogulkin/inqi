import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Controller('reports')
export class ReportsController {
  constructor(private db: PrismaService) {}
  @Get(':token') get(@Param('token') token: string) {
    return this.db.report.findUniqueOrThrow({ where: { token } });
  }
}
