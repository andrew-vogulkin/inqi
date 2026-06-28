import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BossService } from '../queue/boss.service';
import { OutboxService } from '../events/outbox.service';
import { CommsService } from './comms.service';
import { CommsController } from './comms.controller';

@Global()
@Module({ controllers: [CommsController], providers: [PrismaService, BossService, OutboxService, CommsService], exports: [CommsService] })
export class CommsModule {}
