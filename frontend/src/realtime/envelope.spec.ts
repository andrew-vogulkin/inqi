import { describe, it, expect } from 'vitest';
import { EventType } from '@inqi/shared';
import { parseEvent, createIngestState, ingest } from './envelope';

const ev = (id: string, over: Record<string, unknown> = {}) => ({ id, type: EventType.InquiryUpdated, reportId: 'i1', at: 't', data: {}, ...over });

describe('parseEvent — validate the envelope', () => {
  it('accepts a well-formed event', () => {
    expect(parseEvent({ raw: ev('5') })?.id).toBe('5');
  });
  it('rejects malformed payloads', () => {
    expect(parseEvent({ raw: null })).toBeNull();
    expect(parseEvent({ raw: { type: 'x', at: 't' } })).toBeNull(); // no id
    expect(parseEvent({ raw: { id: '1', at: 't' } })).toBeNull();   // no type
    expect(parseEvent({ raw: { id: '1', type: 'x' } })).toBeNull(); // no at
  });
});

describe('ingest — dedupe + cursor + out-of-order safe', () => {
  it('returns only fresh events and advances the cursor', () => {
    const state = createIngestState();
    const a = ingest({ state, batch: [ev('1'), ev('2')] });
    expect(a.fresh.map((e) => e.id)).toEqual(['1', '2']);
    expect(state.cursor).toBe('2');
  });
  it('drops duplicates by id across batches (idempotent)', () => {
    const state = createIngestState();
    ingest({ state, batch: [ev('1'), ev('2')] });
    const b = ingest({ state, batch: [ev('2'), ev('3')] }); // 2 is a dup (replay overlap)
    expect(b.fresh.map((e) => e.id)).toEqual(['3']);
    expect(state.cursor).toBe('3');
  });
  it('is out-of-order safe — a stale id does not move the cursor back', () => {
    const state = createIngestState('5');
    const r = ingest({ state, batch: [ev('3'), ev('7')] });
    expect(r.fresh.map((e) => e.id)).toEqual(['3', '7']); // both fresh (unseen)...
    expect(state.cursor).toBe('7');                        // ...but the cursor only moves forward
  });
  it('skips malformed events in a batch', () => {
    const state = createIngestState();
    const r = ingest({ state, batch: [ev('1'), { bogus: true }, ev('2')] });
    expect(r.fresh.map((e) => e.id)).toEqual(['1', '2']);
  });
});
