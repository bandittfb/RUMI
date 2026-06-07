/**
 * U(x): the utilization field.
 *
 * What is actually being used? Utilization comes from optional telemetry —
 * routes hit, APIs called, workflows completed. RUMI works with just code +
 * corrections, but confidence in a latent affordance rises sharply when usage
 * evidence confirms the capability is NOT already being exercised.
 *
 * CRITICAL distinction (F1): a capability with NO usage record is "unknown",
 * NOT "confirmed zero". Treating missing telemetry as zero makes every gap in
 * instrumentation read as the strongest possible collapse signal — so a single
 * mistyped or absent usage key can promote an already-shipped, heavily-used
 * capability to the #1 "build this" candidate. We therefore track which
 * capabilities actually have a usage observation, and let the collapse engine
 * (a) use a neutral prior instead of the optimistic zero for unknown usage, and
 * (b) drive confidence down for unverified usage.
 */
import type { UsageEvent } from "../core/types.js";

export interface UsageAggregate {
  /** Summed usage count per capability that has at least one observation. */
  totals: Record<string, number>;
  /** Capability ids for which usage was actually observed (vs. simply absent). */
  known: Set<string>;
}

export function aggregateUsage(events: UsageEvent[]): UsageAggregate {
  const totals: Record<string, number> = {};
  const known = new Set<string>();
  for (const e of events) {
    totals[e.capability] = (totals[e.capability] ?? 0) + Math.max(0, e.count);
    known.add(e.capability);
  }
  return { totals, known };
}
