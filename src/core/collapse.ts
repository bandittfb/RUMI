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
/** Confidence multiplier applied when utilization is unknown rather than observed. */
const UNKNOWN_UTIL_CONFIDENCE = 0.2;
/** Sample size at which correction count alone yields ~0.6 confidence. */
const CORRECTION_CONFIDENCE_K = 3;

/**
 * Scan-independent calibration knobs (F3). Each field is scored by `saturate`
 * against a FIXED reference rather than the per-scan maximum, so a capability's
 * Collapse Potential depends only on its own evidence — not on which other
 * capabilities share the scan.
 *
 *   cHalf             correction count at which pressure is ~63% of saturation
 *   kHalf             distinct files at which spread is ~63% of saturation
 *   uHalf             usage count at which a capability counts as ~63% "in use"
 *   unknownUtilPrior  utilization assumed when telemetry is absent (neither 0 nor 1)
 *
 * These are RUMI's own degrees of freedom. Level-2 reflection (`reflect`)
 * perturbs them to test whether a discovery is robust or an artifact of tuning.
 */
export interface CollapseConfig {
  cHalf: number;
  kHalf: number;
  uHalf: number;
  unknownUtilPrior: number;
}

export const DEFAULT_COLLAPSE_CONFIG: CollapseConfig = {
  cHalf: 3,
  kHalf: 2,
  uHalf: 20,
  unknownUtilPrior: 0.5
};

export function computeReadings(
  inputs: CollapseInputs,
  config: CollapseConfig = DEFAULT_COLLAPSE_CONFIG
): FieldReading[] {
  const { capabilities, corrections, capacity, usage } = inputs;
  const { cHalf, kHalf, uHalf, unknownUtilPrior } = config;

  const readings: FieldReading[] = capabilities.map((cap) => {
    const agg = corrections[cap.id];
    const ev = capacity[cap.id];

    // C(x): coherent demand pressure (weighted across signal kinds), scored
    // against a fixed scale. Heat raises demand; only arrows raise confidence.
    const correction = agg
      ? clamp01(saturate(agg.demand, cHalf) * (0.5 + 0.5 * agg.coherence))
      : 0;

    // K(x): breadth (share of declared signals found) × scan-independent spread.
    const breadth = cap.signals.length > 0 && ev
      ? ev.matchedSignals.length / cap.signals.length
      : 0;
    const capacityVal = clamp01(breadth * saturate(ev?.files.length ?? 0, kHalf));

    // U(x): observed utilization on a fixed scale; absent telemetry is "unknown".
    const utilizationKnown = usage.known.has(cap.id);
    const utilization = utilizationKnown
      ? saturate(usage.totals[cap.id] ?? 0, uHalf)
      : 0;

    // For the CP magnitude, an unknown utilization uses a neutral prior rather
    // than the optimistic zero, so absent telemetry cannot masquerade as
    // "confirmed unused" and inflate the score to its maximum.
    const uForCP = utilizationKnown ? utilization : unknownUtilPrior;
    const collapsePotential = correction * capacityVal * (1 - uForCP);

    const correctionConfidence = correctionConf(agg);
    const capacityConfidence = capacityConf(ev, cap.signals.length);
    const utilizationConfidence = utilizationKnown ? 1 : UNKNOWN_UTIL_CONFIDENCE;
    const confidence =
      correctionConfidence * capacityConfidence * utilizationConfidence;

    // Collapse Score — the PRIMARY ranking, from the WorldForge v2 causal
    // benchmark: demand × confidence × unused-ness. Capacity is DEMOTED from a
    // multiplicative magnitude gate (which the benchmark showed is net-harmful in
    // all 8 noise regimes — text-presence capacity is a noisy proxy for real
    // buildability) to a CONFIDENCE factor: it survives in capacityConfidence
    // (which still zeroes out unsupported wishes), it just no longer multiplies
    // the magnitude. Collapse Potential (C·K·(1−U)) is retained below for
    // reference/continuity. Synthetic-validated; real-data validation pending.
    const collapseScore = correction * confidence * (1 - utilization);

    return {
      capability: cap.id,
      label: cap.label,
      correction: round(correction),
      capacity: round(capacityVal),
      utilization: round(utilization),
      collapseScore: round(collapseScore),
      collapsePotential: round(collapsePotential),
      confidence: round(confidence),
      utilizationKnown,
      evidence: {
        correctionCount: agg?.count ?? 0,
        demand: round(agg?.demand ?? 0),
        arrowShare: round(agg?.arrowShare ?? 0),
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

  // Rank by Collapse Score (the benchmark-validated primary observable), not the
  // legacy Collapse Potential.
  readings.sort((a, b) => b.collapseScore - a.collapseScore);
  return readings;
}

/**
 * Confidence that the correction pressure is real: rises with sample size
 * (saturating) and is capped when corrections carry no direction tags. Untagged
 * corrections no longer score as if they were neutrally coherent — withholding
 * direction lowers confidence rather than buying a free 0.5 (F4).
 */
function correctionConf(agg: CorrectionAggregate | undefined): number {
  if (!agg || agg.demand <= 0) return 0;
  const sampleSize = 1 - Math.exp(-agg.demand / CORRECTION_CONFIDENCE_K);
  const directionFactor = agg.directionKnown ? 0.5 + 0.5 * agg.coherence : 0.5;
  // arrowShare keeps heat honest: demand with no revealed direction (all
  // abandonment/retry) earns no confidence — we know something is wanted, not what.
  return clamp01(sampleSize * agg.arrowShare * directionFactor);
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

/** Classification thresholds — what counts as "high" / "low" for a field. */
export interface ClassifyThresholds {
  hi: number;
  lo: number;
}

export const DEFAULT_THRESHOLDS: ClassifyThresholds = { hi: 0.6, lo: 0.34 };

export type Category =
  | "uncollapsed-feature"
  | "candidate-unverified"
  | "unsupported-wish"
  | "dormant-capacity"
  | "already-collapsed"
  | "low-signal";

/** The category a reading falls into, given thresholds. The basis of `interpret`. */
export function categorize(
  r: FieldReading,
  thresholds: ClassifyThresholds = DEFAULT_THRESHOLDS
): Category {
  const hi = (x: number) => x >= thresholds.hi;
  const lo = (x: number) => x <= thresholds.lo;
  if (hi(r.correction) && hi(r.capacity) && !r.utilizationKnown) return "candidate-unverified";
  if (hi(r.correction) && hi(r.capacity) && lo(r.utilization)) return "uncollapsed-feature";
  if (hi(r.correction) && lo(r.capacity)) return "unsupported-wish";
  if (hi(r.capacity) && lo(r.correction) && lo(r.utilization)) return "dormant-capacity";
  if (hi(r.utilization)) return "already-collapsed";
  return "low-signal";
}

/** Whether a category represents a latent feature RUMI is surfacing as a lead. */
export function isCandidate(category: Category): boolean {
  return category === "uncollapsed-feature" || category === "candidate-unverified";
}

const CATEGORY_TEXT: Record<Category, string> = {
  "candidate-unverified":
    "Candidate uncollapsed feature — BUT utilization is unknown: confirm it isn't already in use before acting.",
  "uncollapsed-feature":
    "Uncollapsed feature: strong correction pressure meets latent capacity that is barely used.",
  "unsupported-wish":
    "Unsupported wish: users push toward this, but the code does not yet support it.",
  "dormant-capacity": "Dormant capacity: the code supports it, but nobody is asking for it.",
  "already-collapsed": "Already collapsed: this capability is realized and in active use.",
  "low-signal": "Low signal: no strong collapse pressure in this region."
};

/** A short, human interpretation of where a reading sits in the field. */
export function interpret(r: FieldReading, thresholds: ClassifyThresholds = DEFAULT_THRESHOLDS): string {
  return CATEGORY_TEXT[categorize(r, thresholds)];
}
