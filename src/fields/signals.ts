/**
 * Intent-gap signal kinds — the generalized demand intake.
 *
 * RUMI's demand field was originally fed only by corrections (selected → fixed).
 * But a correction is just the cleanest evidence of a broader thing: the gap
 * between what people are trying to do and what the system lets them do. All
 * sorts of behaviour reveal that gap — the difference is whether the behaviour
 * carries an ARROW (it tells you which way to build) or only HEAT (it tells you
 * there's friction, but not the destination).
 *
 *   arrow  — correction, explicit request, a repeated manual sequence: these
 *            name a direction, so they build confidence in WHAT to build.
 *   heat   — abandonment, retry: real demand signal, but directionless. They
 *            raise the demand magnitude without telling you what to build, so
 *            they must NOT inflate confidence.
 *
 * Each kind has a weight (how strongly it indicates unmet intent) and whether it
 * is directional. Corrections weigh most and are directional — the gold standard
 * the rest are measured against. The confidence machinery then keeps heat honest:
 * lots of abandonment says "something is wanted here" loudly, but with low
 * confidence because nobody has revealed the destination.
 */
export interface SignalKind {
  weight: number;
  directional: boolean;
  label: string;
}

export const SIGNAL_KINDS: Record<string, SignalKind> = {
  correction: { weight: 1.0, directional: true, label: "correction" },
  request: { weight: 1.0, directional: true, label: "explicit request" },
  repetition: { weight: 0.8, directional: true, label: "repeated manual sequence" },
  workaround: { weight: 0.6, directional: true, label: "external workaround" },
  abandonment: { weight: 0.5, directional: false, label: "abandonment (heat)" },
  retry: { weight: 0.4, directional: false, label: "retry (heat)" }
};

export function signalKind(kind?: string): SignalKind {
  return (kind && SIGNAL_KINDS[kind]) || SIGNAL_KINDS.correction;
}
