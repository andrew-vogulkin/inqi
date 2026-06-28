import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InquiriesService } from './inquiries.service';
import { InquiriesController } from './inquiries.controller';

@Module({ controllers: [InquiriesController], providers: [PrismaService, InquiriesService] })
export class InquiriesModule {}
