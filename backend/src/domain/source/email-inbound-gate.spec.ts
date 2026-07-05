import { EventType, ReviewStatus } from '@inqi/shared';
import { EmailChannelService } from './email.service';

/**
 * Inbound compliance gate: a blocked provider reply is persisted for AUDIT but never
 * announced (no message.received) — the agent layer fails the inquiry on `blocked`.
 */
function svcWith({ review }: { review: { status: ReviewStatus; score?: number; categories?: string[]; reason?: string } }) {
  const created: Record<string, unknown>[] = [];
  const prisma = { $transaction: (fn: (tx: unknown) => Promise<unknown>) => fn({}) };
  const emails = {
    findMessageByExternalId: jest.fn().mockResolvedValue(null),
    createMessage: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      created.push(data);
      return Promise.resolve({ id: 'm1', ...data, createdAt: new Date() });
    }),
  };
  const sources = {
    findThreadByReplyAddress: jest.fn().mockResolvedValue({ id: 'src1', inquiry: { id: 's1', reportId: 'r1', epicId: 'e1', name: 'Acme' } }),
    updateThreadState: jest.fn().mockResolvedValue({}),
  };
  const outbox = { emit: jest.fn().mockResolvedValue(undefined) };
  const config = { inboundDomain: 'reply.inqi.example' };
  const compliance = { score: jest.fn().mockResolvedValue({ score: 0.9, categories: [], reason: '', ...review }) };
  const svc = new EmailChannelService(
    prisma as never, emails as never, sources as never, outbox as never, config as never,
    {} as never /* mail */, compliance as never, {} as never /* ai */, {} as never /* usage */,
  );
  return { svc, created, outbox, compliance };
}

const inbound = { toAddr: 'tok123@reply.inqi.example', fromAddr: 'sales@acme.example', subject: 'Re: hi', body: 'a reply' };

describe('EmailChannelService.ingestInbound — compliance gate', () => {
  it('a passing reply is stored and announced (message.received)', async () => {
    const { svc, outbox, created } = svcWith({ review: { status: ReviewStatus.Passed } });
    const r = await svc.ingestInbound(inbound);
    expect(r.blocked).toBe(false);
    expect(created[0]).toMatchObject({ reviewStatus: ReviewStatus.Passed });
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({ type: EventType.MessageReceived }));
  });

  it('a BLOCKED reply is persisted for audit but never announced, and returns blocked=true', async () => {
    const { svc, outbox, created } = svcWith({ review: { status: ReviewStatus.Blocked, reason: 'unlawful content' } });
    const r = await svc.ingestInbound(inbound);
    expect(r.blocked).toBe(true);
    expect(created[0]).toMatchObject({ reviewStatus: ReviewStatus.Blocked, body: 'a reply' }); // audit row exists
    expect(outbox.emit).not.toHaveBeenCalled(); // the customer never sees it stream in
  });
});
