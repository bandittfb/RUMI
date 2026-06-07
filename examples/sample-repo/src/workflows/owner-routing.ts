// Owner routing + blocker tracking. The pieces a renewal-risk review needs to
// assign accountability — present, but not joined to renewals or reports.
export interface Blocker { id: string; ownerId: string; note: string; }

export function ownerRouting(blockers: Blocker[]): Record<string, Blocker[]> {
  const byOwner: Record<string, Blocker[]> = {};
  for (const b of blockers) {
    (byOwner[b.ownerId] ??= []).push(b);
  }
  return byOwner;
}
