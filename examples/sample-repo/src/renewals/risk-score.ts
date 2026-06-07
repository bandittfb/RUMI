// Renewal risk scoring primitives. These exist, but nothing composes them
// into a renewal-risk review workflow yet.
export interface Account {
  id: string;
  renewalDate: string; // ISO date of next renewal
}

export function riskScore(account: Account, openBlockers: number): number {
  const daysOut = (Date.parse(account.renewalDate) - Date.now()) / 86_400_000;
  const urgency = Math.max(0, 1 - daysOut / 90);
  return Math.min(1, urgency * 0.6 + Math.min(openBlockers, 5) * 0.08);
}
