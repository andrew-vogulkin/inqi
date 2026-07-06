import { ConvState, EventType, SourceType } from '@inqi/shared';
import { SourcesService } from './sources.service';

function makeService() {
  const repo = {
    upsertFlat: jest.fn(async (a: { inquiryId: string; url: string; type: string }) => ({ id: `src-${a.url}`, inquiryId: a.inquiryId, type: a.type, url: a.url, title: null, snippet: null, createdAt: new Date('2026-07-02T00:00:00Z') })),
    findThread: jest.fn(async () => null as unknown),
    createThread: jest.fn(async (a: { inquiryId: string; replyAddress: string; convState: string }) => ({ id: 'thread-1', type: SourceType.Email, ...a })),
    updateThreadState: jest.fn(async () => ({})),
    findThreadByReplyAddress: jest.fn(async () => null),
    listByInquiry: jest.fn(async () => []),
    listByReport: jest.fn(async () => []),
  };
  const outbox = { emit: jest.fn(async () => undefined) };
  const config = { inboundDomain: 'reply.inqi.example' };
  const svc = new SourcesService(repo as never, outbox as never, config as never);
  return { svc, repo, outbox };
}

describe('SourcesService', () => {
  it('upserts websearch results per (inquiry, type, url) and emits ONE source.added', async () => {
    const { svc, repo, outbox } = makeService();
    const rows = await svc.addWebsearch({
      reportId: 'r1', inquiryId: 'q1',
      results: [{ url: 'https://a', title: 'A' }, { url: 'https://b', snippet: 'B' }],
    });
    expect(rows).toHaveLength(2);
    expect(repo.upsertFlat).toHaveBeenCalledTimes(2);
    expect(repo.upsertFlat).toHaveBeenCalledWith(expect.objectContaining({ inquiryId: 'q1', type: SourceType.Websearch, url: 'https://a' }));
    expect(outbox.emit).toHaveBeenCalledTimes(1);
    expect(outbox.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: EventType.SourceAdded, reportId: 'r1', inquiryId: 'q1',
      // the event carries SourceDto rows so the admin board appends live without a refetch
      data: expect.objectContaining({
        type: SourceType.Websearch, count: 2,
        sources: expect.arrayContaining([expect.objectContaining({ id: 'src-https://a', url: 'https://a', createdAt: expect.any(String) })]),
      }),
    }));
  });

  it('does nothing (no event) for an empty entry list', async () => {
    const { svc, repo, outbox } = makeService();
    const rows = await svc.addRatingFeedback({ reportId: 'r1', inquiryId: 'q1', entries: [] });
    expect(rows).toEqual([]);
    expect(repo.upsertFlat).not.toHaveBeenCalled();
    expect(outbox.emit).not.toHaveBeenCalled();
  });

  it('ensureEmailThread creates the anchor once with a unique reply address + idle state', async () => {
    const { svc, repo } = makeService();
    const thread = await svc.ensureEmailThread({ inquiryId: 'q1' });
    expect(repo.createThread).toHaveBeenCalledWith(expect.objectContaining({
      inquiryId: 'q1', type: SourceType.Email, convState: ConvState.Idle,
      replyAddress: expect.stringMatching(/^[0-9a-f]{32}@reply\.inqi\.example$/),
    }));
    expect(thread.id).toBe('thread-1');
  });

  it('ensureEmailThread is idempotent — an existing thread short-circuits (original replyAddress kept)', async () => {
    const { svc, repo } = makeService();
    const existing = { id: 'thread-0', type: SourceType.Email, replyAddress: 'tok@reply.inqi.example' };
    repo.findThread.mockResolvedValueOnce(existing);
    const thread = await svc.ensureEmailThread({ inquiryId: 'q1' });
    expect(thread).toBe(existing);
    expect(repo.createThread).not.toHaveBeenCalled();
  });
});

describe('blockThread — compliance quarantine of ONE channel', () => {
  it('closes the thread and marks it blocked with the reason, preserving existing data', async () => {
    const updates: Record<string, unknown>[] = [];
    const db = {
      source: {
        findUnique: jest.fn().mockResolvedValue({ data: { channel: 'sales' } }),
        update: jest.fn().mockImplementation((args: Record<string, unknown>) => { updates.push(args); return Promise.resolve({}); }),
      },
    };
    const { SourcesRepository } = await import('./sources.repository');
    const repo = new SourcesRepository(db as never);
    await repo.blockThread({ sourceId: 'src1', reason: 'inbound reply blocked by the compliance review' });
    expect(updates[0]).toMatchObject({
      where: { id: 'src1' },
      data: { convState: 'closed', data: { channel: 'sales', blocked: true, blockedReason: 'inbound reply blocked by the compliance review' } },
    });
  });
});
