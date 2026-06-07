/**
 * The collapse engine — RUMI's candidate discovery.
 *
 * Given the three aggregated fields it computes, per capability, the normalized
 * readings C(x), K(x), U(x) and the derived observable:
 *
 *     Collapse Potential   CP(x) = C(x) * K(x) * (1 - U(x))
 *
 * CP is high only when correction pressure is high, the code already supports
 * the capability, AND it is barely used. That is the "uncollapsed feature"
 * region — a capability the system is already trying to become.
 *
 * CP is intentionally NOT a simple function of any single existing metric:
 *   - high corrections alone -> not enough (may be unsupported wish)
 *   - high capacity alone     -> not enough (dormant code nobody wants)
 *   - low usage alone         -> not enough (nobody wants it either)
 * The product gates the discovery on all three at once.
 */
import type {
  CapabilityDef,
  CapacityEvidence,
  FieldReading
} from "./types.js";
import { clamp01, round, saturate } from "./normalize.js";
import type { CorrectionAggregate } from "../fields/correction.js";
import type { UsageAggregate } from "../fields/utilization.js";

export interface CollapseInputs {
  capabilities: CapabilityDef[];
  corrections: Record<string, CorrectionAggregate>;
  capacity: Record<string, CapacityEvidence>;
  usage: UsageAggregate;
}

/**
 * When utilization is UNKNOWN (no telemetry observed for a capability), we must
 * not assume it is unused — that is exactly the failure that lets a mistyped or
 * missing usage key promote an already-shipped capability to the top. Instead
 * of the optimistic U=0 (→ full (1-U)=1), we use a neutral prior for the CP
 * magnitude and let confidence carry the uncertainty.
 */
const UNKNOWN_UTIL_PRIOR = 0.5;
/** Confidence multiplier applied when utilization is unknown rather than observed. */
const UNKNOWN_UTIL_CONFIDENCE = 0.2;
/** Sample size at which correction count alone yields ~0.6 confidence. */
const CORRECTION_CONFIDENCE_K = 3;

/**
 * Scan-independent calibration scales (F3). Each field is scored by `saturate`
 * against a FIXED reference rather than the per-scan maximum, so a capability's
 * Collapse Potential depends only on its own evidence — not on which other
 * capabilities share the scan. These are the instrument's calibration knobs:
 *
 *   C_HALF  correction count at which pressure is ~63% of saturation
 *   K_HALF  number of distinct files at which spread is ~63% of saturation
 *   U_HALF  usage count at which a capability counts as ~63% "in use"
 *
 * U_HALF in particular is domain-dependent (what counts as "used" differs by
 * product scale); it is exposed here as the primary knob to calibrate per repo.
 */
const C_HALF = 3;
const K_HALF = 2;
const U_HALF = 20;

export function computeReadings(inputs: CollapseInputs): FieldReading[] {
  const { capabilities, corrections, capacity, usage } = inputs;

  const readings: FieldReading[] = capabilities.map((cap) => {
    const agg = corrections[cap.id];
    const ev = capacity[cap.id];

    // C(x): coherent correction pressure, scored against a fixed scale.
    const correction = agg
      ? clamp01(saturate(agg.count, C_HALF) * (0.5 + 0.5 * agg.coherence))
      : 0;

    // K(x): breadth (share of declared signals found) × scan-independent spread.
    const breadth = cap.signals.length > 0 && ev
      ? ev.matchedSignals.length / cap.signals.length
      : 0;
    const capacityVal = clamp01(breadth * saturate(ev?.files.length ?? 0, K_HALF));

    // U(x): observed utilization on a fixed scale; absent telemetry is "unknown".
    const utilizationKnown = usage.known.has(cap.id);
    const utilization = utilizationKnown
      ? saturate(usage.totals[cap.id] ?? 0, U_HALF)
      : 0;

    // For the CP magnitude, an unknown utilization uses a neutral prior rather
    // than the optimistic zero, so absent telemetry cannot masquerade as
    // "confirmed unused" and inflate the score to its maximum.
    const uForCP = utilizationKnown ? utilization : UNKNOWN_UTIL_PRIOR;
    const collapsePotential = correction * capacityVal * (1 - uForCP);

    const correctionConfidence = correctionConf(agg);
    const capacityConfidence = capacityConf(ev, cap.signals.length);
    const utilizationConfidence = utilizationKnown ? 1 : UNKNOWN_UTIL_CONFIDENCE;
    const confidence =
      correctionConfidence * capacityConfidence * utilizationConfidence;

    return {
      capability: cap.id,
      label: cap.label,
      correction: round(correction),
      capacity: round(capacityVal),
      utilization: round(utilization),
      collapsePotential: round(collapsePotential),
      confidence: round(confidence),
      utilizationKnown,
      evidence: {
        correctionCount: agg?.count ?? 0,
        directionCoherence: round(agg?.coherence ?? 0),
        directionKnown: agg?.directionKnown ?? false,
        capacityFiles: ev?.files ?? [],
        matchedSignals: ev?.matchedSignals ?? [],
        usageCount: usage.totals[cap.id] ?? 0,
        correctionConfidence: round(correctionConfidence),
        capacityConfidence: round(capacityConfidence),
        utilizationConfidence: round(utilizationConfidence)
      }
    };
  });

  readings.sort((a, b) => b.collapsePotential - a.collapsePotential);
  return readings;
}

/**
 * Confidence that the correction pressure is real: rises with sample size
 * (saturating) and is capped when corrections carry no direction tags. Untagged
 * corrections no longer score as if they were neutrally coherent — withholding
 * direction lowers confidence rather than buying a free 0.5 (F4).
 */
function correctionConf(agg: CorrectionAggregate | undefined): number {
  if (!agg || agg.count === 0) return 0;
  const sampleSize = 1 - Math.exp(-agg.count / CORRECTION_CONFIDENCE_K);
  const directionFactor = agg.directionKnown ? 0.5 + 0.5 * agg.coherence : 0.5;
  return clamp01(sampleSize * directionFactor);
}

/**
 * Confidence that the capacity is real: the fraction of a capability's declared
 * signals that were actually found. (This does NOT yet distinguish a symbol in
 * live code from one in a comment or string — that is the AST/symbol step, F2.)
 */
function capacityConf(ev: CapacityEvidence | undefined, declaredSignals: number): number {
  if (!ev || declaredSignals === 0) return 0;
  return clamp01(ev.matchedSignals.length / declaredSignals);
}

/** A short, human interpretation of where a reading sits in the field. */
export function interpret(r: FieldReading): string {
  const hi = (x: number) => x >= 0.6;
  const lo = (x: number) => x <= 0.34;
  if (hi(r.correction) && hi(r.capacity) && !r.utilizationKnown) {
    return "Candidate uncollapsed feature — BUT utilization is unknown: confirm it isn't already in use before acting.";
  }
  if (hi(r.correction) && hi(r.capacity) && lo(r.utilization)) {
    return "Uncollapsed feature: strong correction pressure meets latent capacity that is barely used.";
  }
  if (hi(r.correction) && lo(r.capacity)) {
    return "Unsupported wish: users push toward this, but the code does not yet support it.";
  }
  if (hi(r.capacity) && lo(r.correction) && lo(r.utilization)) {
    return "Dormant capacity: the code supports it, but nobody is asking for it.";
  }
  if (hi(r.utilization)) {
    return "Already collapsed: this capability is realized and in active use.";
  }
  return "Low signal: no strong collapse pressure in this region.";
}
