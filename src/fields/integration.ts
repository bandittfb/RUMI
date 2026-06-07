/**
 * Integration distance D(x) — how far apart a capability's pieces are.
 *
 * A SECONDARY observable, deliberately kept out of Collapse Potential: CP says
 * "this is a latent feature the system wants", D says "and here is how much glue
 * it would take to assemble it". They are orthogonal — a strongly-wanted feature
 * can be either nearly assembled or scattered to the corners.
 *
 *   D = 0    pieces co-located / already connected (low-effort collapse)
 *   D → 1    pieces share no dependency path (composition is real work)
 *
 * Two graphs feed it. The SYMBOL graph (symbols.ts) is preferred: it measures
 * distance between the actual definitions a capability resolves to (does
 * `buildDigest` really reference `sendNotification`?). When a capability's
 * signals don't resolve to ≥2 defined symbols — other languages, or signals that
 * map only to uses — it falls back to the FILE import graph (graph.ts). Either
 * way D is scan-independent: it depends only on the repo and this capability.
 */
import type { ImportGraph } from "./graph.js";
import type { SymbolGraph } from "./symbols.js";
import { signalMatches } from "./capacity-analyzers.js";

/** Mean pairwise dependency distance over the capability's FILES (fallback). */
export function integrationDistance(files: string[], graph: ImportGraph): number | null {
  if (files.length === 0) return null;
  if (files.length === 1) return 0;
  return meanPairwiseDistance(files, graph);
}

/**
 * Mean pairwise distance over the SYMBOLS a capability resolves to. Returns null
 * when fewer than two signals resolve to defined symbols (caller should fall
 * back to the file graph).
 */
export function symbolIntegrationDistance(
  signals: string[],
  symbols: SymbolGraph
): number | null {
  const names = new Set<string>();
  for (const signal of signals) {
    for (const [name, tok] of symbols.nameTokens) {
      if (signalMatches(signal, tok)) names.add(name);
    }
  }
  if (names.size < 2) return null;
  return meanPairwiseDistance([...names], symbols.adjacency);
}

/** A short human reading of an integration distance. */
export function integrationLabel(distance: number | null): string | null {
  if (distance === null) return null;
  if (distance <= 0.1) return "co-located / tightly connected";
  if (distance <= 0.45) return "RIPE — pieces already connected; low-effort to compose";
  if (distance >= 0.75) return "DEEP — pieces with no shared dependency path; real composition work";
  return "MODERATE — pieces partially connected";
}

function meanPairwiseDistance(nodes: string[], adjacency: Map<string, Set<string>>): number {
  let total = 0;
  let pairs = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      const hops = shortestHops(adjacency, nodes[i], nodes[j]);
      // Direct link (1 hop) is close (0.33); each extra hop is farther; no path
      // at all is maximally far (1.0).
      total += hops === null ? 1 : hops / (hops + 2);
      pairs++;
    }
  }
  return pairs ? total / pairs : 0;
}

const MAX_HOPS = 8;

/** Undirected BFS shortest path length between two nodes; null if disconnected. */
function shortestHops(
  adjacency: Map<string, Set<string>>,
  from: string,
  to: string
): number | null {
  if (from === to) return 0;
  const seen = new Set<string>([from]);
  let frontier: string[] = [from];
  let depth = 0;
  while (frontier.length && depth < MAX_HOPS) {
    depth++;
    const next: string[] = [];
    for (const node of frontier) {
      for (const nb of adjacency.get(node) ?? []) {
        if (nb === to) return depth;
        if (!seen.has(nb)) {
          seen.add(nb);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return null;
}
