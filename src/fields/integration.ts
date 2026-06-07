/**
 * Integration distance D(x) — how far apart a capability's pieces are.
 *
 * Given the files where a capability's signals were found, D measures how
 * connected those files are in the repo's import graph. It is a SECONDARY
 * observable, deliberately kept out of Collapse Potential: CP says "this is a
 * latent feature the system wants", D says "and here is how much glue it would
 * take to assemble it". They are orthogonal — a strongly-wanted feature can be
 * either nearly assembled or scattered to the corners.
 *
 *   D = 0    pieces co-located / already connected (low-effort collapse)
 *   D → 1    pieces share no dependency path (composition is real work)
 *
 * Like every RUMI field it is scan-independent: D depends only on the repo graph
 * and this capability's own files, never on other capabilities in the scan.
 */
import type { ImportGraph } from "./graph.js";

/**
 * Mean pairwise dependency distance over the capability's files.
 * Returns null when there is no capacity (nothing to integrate), 0 for a single
 * file (trivially co-located).
 */
export function integrationDistance(files: string[], graph: ImportGraph): number | null {
  if (files.length === 0) return null;
  if (files.length === 1) return 0;

  let total = 0;
  let pairs = 0;
  for (let i = 0; i < files.length; i++) {
    for (let j = i + 1; j < files.length; j++) {
      const hops = shortestHops(graph, files[i], files[j]);
      // Direct import (1 hop) is close (0.33); each extra hop is farther; no
      // dependency path at all is maximally far (1.0).
      total += hops === null ? 1 : hops / (hops + 2);
      pairs++;
    }
  }
  return pairs ? total / pairs : 0;
}

/** A short human reading of an integration distance for `n` capacity files. */
export function integrationLabel(distance: number | null, fileCount: number): string | null {
  if (distance === null || fileCount === 0) return null;
  if (fileCount === 1) return "co-located (single file)";
  if (distance <= 0.45) return "RIPE — pieces already connected; low-effort to compose";
  if (distance >= 0.75) return "DEEP — pieces scattered with no shared dependency path; real composition work";
  return "MODERATE — pieces partially connected";
}

const MAX_HOPS = 8;

/** Undirected BFS shortest path length between two files; null if disconnected. */
function shortestHops(graph: ImportGraph, from: string, to: string): number | null {
  if (from === to) return 0;
  const seen = new Set<string>([from]);
  let frontier: string[] = [from];
  let depth = 0;
  while (frontier.length && depth < MAX_HOPS) {
    depth++;
    const next: string[] = [];
    for (const node of frontier) {
      for (const nb of graph.get(node) ?? []) {
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
