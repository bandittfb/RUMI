// Notification delivery primitive. Exists and is imported by the digest
// builder below — the pieces are connected, just not scheduled.
export interface Notice { to: string; body: string; }

export function sendNotification(notice: Notice): void {
  // single-notice delivery; a weekly-digest workflow would batch these
  void notice;
}
