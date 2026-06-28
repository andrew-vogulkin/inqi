/** A rendered notification ready to deliver on some channel. */
export interface NotificationMessage {
  to: string;
  subject: string;
  body: string;
}

/**
 * Swappable delivery channel (email now via MailProvider; SMS/web-push later).
 * Bind a concrete impl to {@link NOTIFICATION_CHANNEL}, inject by token.
 */
export interface NotificationChannel {
  send(args: NotificationMessage): Promise<void>;
}
export const NOTIFICATION_CHANNEL = Symbol('NotificationChannel');
