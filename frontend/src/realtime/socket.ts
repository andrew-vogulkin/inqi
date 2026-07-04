import { io } from 'socket.io-client';
import { useEffect } from 'react';
import { Room, RoomKind } from '@inqi/shared';
import { useAppDispatch } from '../state/store';
import { ActionType } from '../state/actions';
import { createIngestState, ingest } from './envelope';

/** Which realtime room to join (convention #1: no bare room strings). */
export type RealtimeRoom = { kind: typeof RoomKind.Report; reportId: string } | { kind: typeof RoomKind.Admin };

/**
 * Realtime → reducers (API-02). One Socket.IO client subscribes to the room and
 * **dispatches every typed event into the reducers** (components never touch the
 * socket). Reconnect is non-blocking and **replays by cursor** (no gaps, deduped via
 * {@link ingest}); a successful reconnect dispatches `SocketReconnected` → a "no events
 * missed" toast. Parse/dedupe/cursor logic is the pure `envelope` module.
 */
export function useRealtime(room: RealtimeRoom | null): void {
  const dispatch = useAppDispatch();
  const roomKey = room ? (room.kind === RoomKind.Report ? Room.report(room.reportId) : Room.admin) : 'none';

  useEffect(() => {
    if (!room) return;
    const socket = io({ path: '/socket.io' });
    const state = createIngestState();
    let connectedBefore = false;

    const ingestBatch = (batch: unknown[] | undefined) => {
      const { fresh } = ingest({ state, batch: batch ?? [] });
      for (const e of fresh) dispatch({ type: ActionType.EventReceived, event: e });
    };

    const onConnect = () => {
      socket.emit('subscribe', room.kind === RoomKind.Admin ? { admin: true } : { reportId: room.reportId });
      if (room.kind === RoomKind.Report) {
        socket.emit('replay', { reportId: room.reportId, afterId: state.cursor }, (rows: unknown[]) => ingestBatch(rows));
      }
      if (connectedBefore) dispatch({ type: ActionType.SocketReconnected });
      connectedBefore = true;
    };
    const onEvent = (e: unknown) => ingestBatch([e]);

    socket.on('connect', onConnect);
    socket.on('event', onEvent);
    return () => { socket.off('connect', onConnect); socket.off('event', onEvent); socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomKey, dispatch]);
}

/**
 * Dashboard realtime (FE-03): one socket, joined to every owned report room, so an
 * `report.transitioned` on any of them updates its row live. Replays each by cursor.
 */
export function useRealtimeReports({ reportIds }: { reportIds: string[] }): void {
  const dispatch = useAppDispatch();
  const key = reportIds.slice().sort().join(',');

  useEffect(() => {
    if (!reportIds.length) return;
    const socket = io({ path: '/socket.io' });
    const state = createIngestState();

    const ingestBatch = (batch: unknown[] | undefined) => {
      const { fresh } = ingest({ state, batch: batch ?? [] });
      for (const e of fresh) dispatch({ type: ActionType.EventReceived, event: e });
    };
    const onConnect = () => {
      for (const id of reportIds) {
        socket.emit('subscribe', { reportId: id });
        socket.emit('replay', { reportId: id, afterId: '0' }, (rows: unknown[]) => ingestBatch(rows));
      }
    };
    const onEvent = (e: unknown) => ingestBatch([e]);

    socket.on('connect', onConnect);
    socket.on('event', onEvent);
    return () => { socket.off('connect', onConnect); socket.off('event', onEvent); socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, dispatch]);
}
