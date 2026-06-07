// Digest builder. Already composes notices via sendNotification, but no
// scheduled weekly-digest workflow drives it yet.
import { sendNotification, Notice } from "./sender.js";

export function buildDigest(items: string[]): Notice {
  const notice: Notice = { to: "team", body: items.join("\n") };
  sendNotification(notice);
  return notice;
}
