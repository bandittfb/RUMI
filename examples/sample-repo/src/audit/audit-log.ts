// Audit log — realized and used.
export interface AuditEntry { actorId: string; action: string; at: string; }

export function auditLog(entries: AuditEntry[]) {
  return { eventTrail: entries, count: entries.length };
}
