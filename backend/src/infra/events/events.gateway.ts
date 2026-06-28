import { OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, SubscribeMessage, MessageBody, ConnectedSocket } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Client } from 'pg';
import { PrismaService } from '../persistence/prisma.service';

/** Socket.IO rooms: `inquiry:<id>` (customer) and `admin` (everything).
 *  Fed by Postgres LISTEN 'inqi_events' (low-latency nudge) + outbox row read. */
@WebSocketGateway({ cors: { origin: process.env.WEB_ORIGIN ?? '*' } })
export class EventsGateway implements OnModuleInit {
  @WebSocketServer() server!: Server;
  constructor(private readonly db: PrismaService) {}

  async onModuleInit() {
    const pg = new Client(process.env.DATABASE_URL);
    await pg.connect();
    await pg.query('LISTEN inqi_events');
    pg.on('notification', async (n) => {
      const row = await this.db.eventOutbox.findUnique({ where: { id: BigInt(n.payload!) } });
      if (!row) return;
      const evt = this.toEnvelope(row);
      this.server.to(`inquiry:${row.inquiryId}`).emit('event', evt);
      this.server.to('admin').emit('event', evt);
    });
  }

  /** Serialize an outbox row to the shared InqiEvent envelope (id as string cursor, `at` ISO). */
  private toEnvelope(row: { id: bigint; type: string; inquiryId: string; epicId: string | null; subtaskId: string | null; data: unknown; createdAt: Date }) {
    return {
      id: row.id.toString(),
      type: row.type,
      inquiryId: row.inquiryId,
      epicId: row.epicId ?? undefined,
      subtaskId: row.subtaskId ?? undefined,
      at: row.createdAt.toISOString(),
      data: row.data,
    };
  }

  @SubscribeMessage('subscribe')
  onSubscribe(@ConnectedSocket() c: Socket, @MessageBody() b: { inquiryId?: string; admin?: boolean }) {
    if (b.admin) c.join('admin');
    if (b.inquiryId) c.join(`inquiry:${b.inquiryId}`);
    return { ok: true };
  }

  /** Replay missed events after a cursor (reconnect). */
  @SubscribeMessage('replay')
  async onReplay(@MessageBody() b: { inquiryId: string; afterId?: string }) {
    const rows = await this.db.eventOutbox.findMany({
      where: { inquiryId: b.inquiryId, id: { gt: BigInt(b.afterId ?? '0') } },
      orderBy: { id: 'asc' }, take: 200,
    });
    return rows.map((r) => this.toEnvelope(r));
  }
}
