import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/** Infra (@Global): Prisma access for the whole app. */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PersistenceModule {}
