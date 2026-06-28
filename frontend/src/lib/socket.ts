import { io, Socket } from 'socket.io-client';
import { useEffect, useRef, useState } from 'react';

export interface InqiEvent { id: string; type: string; inquiryId: string; epicId?: string; subtaskId?: string; data: any; createdAt: string; }

let socket: Socket | null = null;
function getSocket() { return (socket ??= io({ path: '/socket.io' })); }

/** Subscribe to live events; admin=true streams everything, else a single inquiry. */
export function useEvents(opts: { inquiryId?: string; admin?: boolean }) {
  const [events, setEvents] = useState<InqiEvent[]>([]);
  const cursor = useRef<string>('0');
  useEffect(() => {
    const s = getSocket();
    const onConnect = () => {
      s.emit('subscribe', opts);
      if (opts.inquiryId) s.emit('replay', { inquiryId: opts.inquiryId, afterId: cursor.current }, (rows: InqiEvent[]) => {
        if (rows?.length) { setEvents(p => [...p, ...rows]); cursor.current = rows[rows.length - 1].id; }
      });
    };
    const onEvent = (e: InqiEvent) => { setEvents(p => [...p, e]); cursor.current = e.id; };
    s.on('connect', onConnect); s.on('event', onEvent);
    if (s.connected) onConnect();
    return () => { s.off('connect', onConnect); s.off('event', onEvent); };
  }, [opts.inquiryId, opts.admin]);
  return events;
}
