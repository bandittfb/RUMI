/**
 * RUMI core type definitions.
 *
 * RUMI reads three fields over a shared index of "capabilities" — candidate
 * units of latent product structure:
 *
 *   C(x)  Correction field    — what humans keep pushing the system toward
 *   K(x)  Capacity field      — what the codebase structurally can support
 *   U(x)  Utilization field   — what is actually being used
 *
 * The interesting region is high C, high K, low U: the gap where an
 * uncollapsed feature may live. RUMI quantifies that gap as Collapse Potential.
 */

/** A capability is the coordinate over which all three fields are measured. */
export interface CapabilityDef {
  /** Stable key, e.g. "enterprise-renewal-risk". */
  id: string;
  /** Human-facing label, e.g. "Enterprise Renewal Risk Review". */
  label: string;
  /** Keywords/symbols used to detect code capacity for this capability. */
  signals: string[];
  /** Optional notes shown in reports. */
  description?: string;
}

/** A single observed correction event: selected -> corrected. */
export interface CorrectionEvent {
  id: string;
  /** Capability id this correction pushes toward. */
  capability: string;
  /** Redacted "before" (the system selection). */
  before: string;
  /** Redacted "after" (what the human corrected it toward). */
  after: string;
  /** ISO timestamp. */
  at?: string;
  /** Optional unit-vector-ish direction tags for semantic coherence. */
  direction?: string[];
}

/** A usage observation: how much a capability is actually exercised. */
export interface UsageEvent {
  capability: string;
  count: number;
}

/** Code-capacity evidence for one capability. */
export interface CapacityEvidence {
  capability: string;
  /** Files where supporting signals were found. */
  files: string[];
  /** Raw count of signal hits across the repo. */
  hits: number;
  /** Distinct signals matched (of the capability's declared signals). */
  matchedSignals: string[];
}

/** Normalized per-capability field values in [0,1] plus the derived observable. */
export interface FieldReading {
  capability: string;
  label: string;
  /** C(x): correction pressure, normalized. */
  correction: number;
  /** K(x): code capacity, normalized. */
  capacity: number;
  /** U(x): utilization, normalized. */
  utilization: number;
  /** Collapse Potential = C * K * (1 - U), using a prior for unknown U. */
  collapsePotential: number;
  /**
   * Evidence strength behind this reading, in [0,1] — the product of per-field
   * confidences. CP answers "how strong is the collapse signal"; confidence
   * answers "how much should you trust that number". A high CP with low
   * confidence is a lead to verify, not a conclusion to act on (F1).
   */
  confidence: number;
  /** Whether utilization was actually observed (vs. absent/unknown). */
  utilizationKnown: boolean;
  /** Supporting evidence carried through for the report. */
  evidence: {
    correctionCount: number;
    directionCoherence: number;
    /** Whether any correction carried a direction tag. */
    directionKnown: boolean;
    capacityFiles: string[];
    matchedSignals: string[];
    usageCount: number;
    /** Per-field confidence breakdown (each in [0,1]). */
    correctionConfidence: number;
    capacityConfidence: number;
    utilizationConfidence: number;
  };
}

/** The full output of a scan. */
export interface ScanReport {
  generatedAt: string;
  repo: string;
  capabilityCount: number;
  readings: FieldReading[];
}

/** A stored baseline for tracking whether pressure collapses after a change. */
export interface Baseline {
  savedAt: string;
  field: Record<string, { correction: number; capacity: number; utilization: number; collapsePotential: number }>;
}
