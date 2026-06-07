/**
 * K(x): the capacity field.
 *
 * What does the codebase already structurally support? RUMI scans the target
 * repository for the signals declared on each capability (symbols, module
 * names, field names). A capability whose pieces already exist across several
 * files has high latent capacity even if no workflow composes them yet.
 *
 * This is a deliberately lightweight static scan (keyword/symbol presence).
 * It is the seam where a deeper AST/code-graph analyzer plugs in later.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CapabilityDef, CapacityEvidence } from "../core/types.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rb", ".java", ".rs", ".php", ".cs"
]);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".rumi"]);

async function walk(dir: string): Promise<string[]> {
  let entries: import("node:fs").Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      files.push(...(await walk(full)));
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

export async function scanCapacity(
  repoRoot: string,
  capabilities: CapabilityDef[]
): Promise<Record<string, CapacityEvidence>> {
  const files = await walk(repoRoot);
  const contents = new Map<string, string>();
  for (const f of files) {
    try {
      contents.set(f, (await fs.readFile(f, "utf8")).toLowerCase());
    } catch {
      /* skip unreadable */
    }
  }

  const out: Record<string, CapacityEvidence> = {};
  for (const cap of capabilities) {
    const matchedSignals = new Set<string>();
    const matchedFiles = new Set<string>();
    let hits = 0;
    for (const signal of cap.signals) {
      const needle = signal.toLowerCase();
      for (const [file, text] of contents) {
        const occurrences = countOccurrences(text, needle);
        if (occurrences > 0) {
          hits += occurrences;
          matchedSignals.add(signal);
          matchedFiles.add(path.relative(repoRoot, file));
        }
      }
    }
    out[cap.id] = {
      capability: cap.id,
      files: [...matchedFiles].sort(),
      hits,
      matchedSignals: [...matchedSignals].sort()
    };
  }
  return out;
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}
