/**
 * API-03 — realtime room names (API-02 socket layer). Customers join their own
 * `report:{id}` room; operators join the single `admin` room. Kept here so neither
 * side hard-codes the room strings.
 */
export const RoomKind = {
  Report: 'report',
  Admin: 'admin',
} as const;
export type RoomKind = (typeof RoomKind)[keyof typeof RoomKind];

export const Room = {
  admin: 'admin',
  report: (id: string) => `report:${id}`,
} as const;
