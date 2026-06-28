import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

export interface InqiEvent { id: string; type: string; inquiryId: string; epicId?: string; subtaskId?: string; at?: string; data: any; }

let socket: Socket | null = null;
function getSocket() { return (socket ??= io({ path: '/socket.io' })); }

/**
 * Subscribe to live events; admin=true streams everything, else a single inquiry.
 * Events are deduped by their monotonic `id` and kept sorted, so a reconnect that
 * replays from the cursor never produces gaps or duplicates (HP-08).
 */
export function useEvents(opts: { inquiryId?: string; admin?: boolean }) {
  const [events, setEvents] = useState<InqiEvent[]>([]);
  const byId = useRef<Map<string, InqiEvent>>(new Map());
  const cursor = useRef<string>('0');

  function ingest(rows: InqiEvent[]) {
    if (!rows?.length) return;
    let changed = false;
    for (const e of rows) {
      if (!byId.current.has(e.id)) { byId.current.set(e.id, e); changed = true; }
      if (BigInt(e.id) > BigInt(cursor.current)) cursor.current = e.id;
    }
    if (changed) {
      setEvents([...byId.current.values()].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? -1 : 1)));
    }
  }

  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      s.emit('subscribe', opts);
      // Replay everything missed since our cursor, then resume live (no gaps).
      if (opts.inquiryId) s.emit('replay', { inquiryId: opts.inquiryId, afterId: cursor.current }, (rows: InqiEvent[]) => ingest(rows));
    };
    const onEvent = (e: InqiEvent) => ingest([e]);
    s.on('connect', onConnect); s.on('event', onEvent);
    if (s.connected) onConnect();
    return () => { s.off('connect', onConnect); s.off('event', onEvent); };
  }, [opts.inquiryId, opts.admin]);

  return events;
}
