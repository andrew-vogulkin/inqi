/**
 * API-03 — realtime room names (API-02 socket layer). Customers join their own
 * `inquiry:{id}` room; operators join the single `admin` room. Kept here so neither
 * side hard-codes the room strings.
 */
export const RoomKind = {
  Inquiry: 'inquiry',
  Admin: 'admin',
} as const;
export type RoomKind = (typeof RoomKind)[keyof typeof RoomKind];

export const Room = {
  admin: 'admin',
  inquiry: (id: string) => `inquiry:${id}`,
} as const;
