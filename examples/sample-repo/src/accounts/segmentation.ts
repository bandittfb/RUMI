// Enterprise account segmentation.
export type Segment = "smb" | "mid-market" | "enterprise";

export function segmentation(accountSize: number): Segment {
  if (accountSize > 1000) return "enterprise";
  if (accountSize > 100) return "mid-market";
  return "smb";
}
