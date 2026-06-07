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
import { signalKind } from "./signals.js";

export interface CorrectionAggregate {
  capability: string;
  /** Number of signal events (for display). */
  count: number;
  /** Weighted demand across all signal kinds (the magnitude that drives C). */
  demand: number;
  /** Share of demand that carries a direction — arrow vs. heat — in [0,1]. */
  arrowShare: number;
  /** Directional coherence in [0,1] — share of the dominant direction tag. */
  coherence: number;
  /** Whether ANY directional signal carried an explicit direction tag. */
  directionKnown: boolean;
}

export function aggregateCorrections(events: CorrectionEvent[]): Record<string, CorrectionAggregate> {
  const byCap: Record<string, CorrectionEvent[]> = {};
  for (const e of events) {
    (byCap[e.capability] ??= []).push(e);
  }

  const out: Record<string, CorrectionAggregate> = {};
  for (const [capability, evs] of Object.entries(byCap)) {
    let demand = 0;
    let arrowWeight = 0;
    const arrowEvents: CorrectionEvent[] = [];
    for (const e of evs) {
      const kind = signalKind(e.kind);
      const w = e.weight ?? kind.weight;
      demand += w;
      // A signal carries an arrow if its kind is directional AND it actually
      // names a destination (an "after"). Heat kinds never carry an arrow.
      if (kind.directional && e.after && e.after.length > 0) {
        arrowWeight += w;
        arrowEvents.push(e);
      }
    }
    const coherence = directionCoherence(arrowEvents);
    out[capability] = {
      capability,
      count: evs.length,
      demand,
      arrowShare: demand > 0 ? clamp01(arrowWeight / demand) : 0,
      coherence: clamp01(coherence),
      directionKnown: arrowEvents.some((e) => (e.direction?.length ?? 0) > 0)
    };
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
