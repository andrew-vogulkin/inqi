import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxService } from './outbox.service';
import { EventsGateway } from './events.gateway';

@Global()
@Module({ providers: [PrismaService, OutboxService, EventsGateway], exports: [OutboxService] })
export class EventsModule {}
