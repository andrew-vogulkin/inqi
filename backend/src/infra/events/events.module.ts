import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { EventsGateway } from './events.gateway';

/** Infra (@Global): EventOutbox + LISTEN/NOTIFY + Socket.IO gateway. */
@Global()
@Module({ providers: [OutboxService, EventsGateway], exports: [OutboxService] })
export class EventsModule {}
