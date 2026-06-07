/** Small numeric helpers shared by the field engines. */

export function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/** Round to a fixed number of decimals for stable, readable output. */
export function round(x: number, places = 3): number {
  const f = 10 ** places;
  return Math.round(x * f) / f;
}

/**
 * Saturating map of a non-negative quantity into [0,1): `1 - exp(-value/half)`.
 *
 * This is the basis of RUMI's *scan-independent* field scores (F3). Unlike
 * max-normalization, the result depends only on the value and a fixed scale
 * `half` (the value at which the score reaches ~0.63) — never on what other
 * capabilities happen to be in the same scan. That makes Collapse Potential
 * stable across scans, so `experiment compare` is a real before/after test and
 * auto-proposed capabilities don't re-rank their neighbours just by appearing.
 */
export function saturate(value: number, half: number): number {
  if (!(value > 0) || !(half > 0)) return 0;
  return clamp01(1 - Math.exp(-value / half));
}
