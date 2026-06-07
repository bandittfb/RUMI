/**
 * C(x): the correction field.
 *
 * This is the Rectifier Seed core — the original correction-field engine that
 * RUMI is built on. It reads correction events (selected -> corrected) and,
 * per capability, combines:
 *
 *   - density:     how many corrections push toward this capability
 *   - coherence:   how directionally consistent those corrections are
 *
 * A capability that is corrected toward often AND consistently carries more
 * correction pressure than one that is corrected toward occasionally or in
 * scattered directions.
 */
import type { CorrectionEvent } from "../core/types.js";
import { clamp01 } from "../core/normalize.js";

export interface CorrectionAggregate {
  capability: string;
  count: number;
  /** Directional coherence in [0,1] — share of the dominant direction tag. */
  coherence: number;
  /** Whether ANY correction carried a direction tag (vs. all untagged). */
  directionKnown: boolean;
}

export function aggregateCorrections(events: CorrectionEvent[]): Record<string, CorrectionAggregate> {
  const byCap: Record<string, CorrectionEvent[]> = {};
  for (const e of events) {
    (byCap[e.capability] ??= []).push(e);
  }

  const out: Record<string, CorrectionAggregate> = {};
  for (const [capability, evs] of Object.entries(byCap)) {
    const count = evs.length;
    const coherence = directionCoherence(evs);
    const directionKnown = evs.some((e) => (e.direction?.length ?? 0) > 0);
    out[capability] = { capability, count, coherence: clamp01(coherence), directionKnown };
  }
  return out;
}

/**
 * Share of corrections that move in the single most common direction.
 * 1.0 = every correction pushes the same way; ~0 = scattered.
 */
function directionCoherence(events: CorrectionEvent[]): number {
  const tally: Record<string, number> = {};
  let tagged = 0;
  for (const e of events) {
    for (const d of e.direction ?? []) {
      tally[d] = (tally[d] ?? 0) + 1;
      tagged++;
    }
  }
  if (tagged === 0) return 0.5; // unknown direction -> neutral coherence
  const dominant = Math.max(...Object.values(tally));
  return dominant / tagged;
}
