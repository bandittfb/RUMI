/**
 * Capability auto-proposal — the divining rod.
 *
 * Every other field in RUMI is measured over capabilities a human DECLARED in
 * capabilities.json. This module removes that scaffolding: it reads the raw
 * correction field and proposes the capabilities itself, from the shape of what
 * users keep correcting the system toward. A dense, lexically coherent knot of
 * corrections that no one named is exactly where an emergent, uncollapsed
 * feature first becomes visible — before anyone has a word for it.
 *
 * The method is deliberately local and zero-dependency (corrections never leave
 * the machine): tokenize the "after" of each correction (what the human pushed
 * toward), cluster events by lexical overlap via single-linkage union-find, and
 * derive each cluster's capacity SIGNALS from the tokens that recur across it.
 * Those synthesized capabilities then flow through the ordinary collapse engine,
 * so each proposal arrives with Collapse Potential AND confidence already
 * attached — a lead to verify, not a conclusion (an auto-proposed capability has
 * no usage record, so its utilization is unknown by construction).
 *
 * This is intentionally a seam: lexical clustering is the floor, not the ceiling
 * (local embeddings / a code-graph join are the planned depth). What matters is
 * that the instrument can now point at a capability nobody declared.
 */
import type { CapabilityDef, CorrectionEvent } from "../core/types.js";

export interface ProposedCapability {
  def: CapabilityDef;
  /** Correction-event ids that formed this cluster. */
  memberIds: string[];
  /** Token → number of member corrections it appeared in. */
  tokenSupport: Record<string, number>;
}

export interface ProposeOptions {
  /** Minimum lexical overlap (overlap-coefficient) to link two corrections. */
  threshold?: number;
  /** Max auto-derived signals per proposed capability. */
  maxSignals?: number;
}

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "and", "or", "with", "by", "per", "as", "at",
  "in", "on", "for", "is", "are", "be", "this", "that", "it", "its", "from",
  "into", "one", "all", "any", "no", "not", "show", "view", "add", "new", "get",
  "set", "use", "via", "out", "up", "off", "than", "then", "so", "more", "less"
]);

/**
 * Programming-language keywords that are legitimate USER words (a person really
 * does say "export everything to CSV") but are useless as capacity SIGNALS — a
 * substring scan for "export" hits the `export` keyword in every TS/JS file and
 * manufactures phantom capacity. We keep these for clustering (they carry user
 * intent) but exclude them when deriving the signals that drive the repo scan.
 */
const CODE_KEYWORDS = new Set([
  "export", "import", "function", "return", "const", "let", "var", "class",
  "default", "type", "interface", "async", "await", "public", "private",
  "static", "void", "null", "true", "false", "string", "number", "boolean"
]);

/** Lowercase, split on non-alphanumerics, drop stopwords/short tokens, light singularize. */
function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 3 || STOPWORDS.has(raw)) continue;
    out.add(singularize(raw));
  }
  return out;
}

function singularize(t: string): string {
  if (t.length > 4 && t.endsWith("s") && !t.endsWith("ss")) return t.slice(0, -1);
  return t;
}

/** |A ∩ B| / min(|A|,|B|) — forgiving for the short texts corrections tend to be. */
function overlapCoefficient(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export function proposeCapabilities(
  events: CorrectionEvent[],
  opts: ProposeOptions = {}
): ProposedCapability[] {
  const threshold = opts.threshold ?? 0.34;
  const maxSignals = opts.maxSignals ?? 6;

  const tokens = events.map((e) => tokenize(e.after));

  // Single-linkage clustering via union-find: link any two corrections whose
  // "after" texts overlap enough, then take connected components as clusters.
  const parent = events.map((_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
  };

  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      if (overlapCoefficient(tokens[i], tokens[j]) >= threshold) union(i, j);
    }
  }

  const groups = new Map<number, number[]>();
  for (let i = 0; i < events.length; i++) {
    const root = find(i);
    (groups.get(root) ?? groups.set(root, []).get(root)!).push(i);
  }

  const proposed: ProposedCapability[] = [];
  for (const indices of groups.values()) {
    const support: Record<string, number> = {};
    for (const i of indices) {
      for (const t of tokens[i]) support[t] = (support[t] ?? 0) + 1;
    }

    // Signals are the tokens that recur across the cluster (the coherent core);
    // for a singleton cluster, fall back to that one correction's own tokens.
    const usable = Object.entries(support).filter(([t]) => !CODE_KEYWORDS.has(t));
    const recurring = usable.filter(([, n]) => n >= 2);
    const ranked = (recurring.length ? recurring : usable)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxSignals)
      .map(([t]) => t);

    if (ranked.length === 0) continue;

    const id = `emergent-${ranked.slice(0, 3).join("-")}`;
    const label =
      ranked.slice(0, 3).map((t) => t[0].toUpperCase() + t.slice(1)).join(" / ") +
      (indices.length > 1 ? ` (×${indices.length})` : "");

    proposed.push({
      def: { id, label, signals: ranked },
      memberIds: indices.map((i) => events[i].id),
      tokenSupport: support
    });
  }

  // Strongest clusters (most corroborating corrections) first; id for stable ties.
  proposed.sort(
    (a, b) => b.memberIds.length - a.memberIds.length || a.def.id.localeCompare(b.def.id)
  );
  return proposed;
}
