/**
 * K(x): the capacity field.
 *
 * What does the codebase already structurally support? RUMI walks the target
 * repository and, per file, extracts the real code identifiers using a
 * language-aware analyzer (see `capacity-analyzers.ts`): the TypeScript compiler
 * for JS/TS, a comment/string-stripping text analyzer for every other language.
 * A capability whose declared (or auto-proposed) signals appear as genuine code
 * across several files has high latent capacity even if no workflow composes
 * them yet — while words in comments, string literals, or language keywords no
 * longer manufacture phantom capacity.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CapabilityDef, CapacityEvidence } from "../core/types.js";
import {
  analyzerForExtension,
  signalMatches,
  type CodeTokens
} from "./capacity-analyzers.js";

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rb", ".java", ".rs", ".php", ".cs"
]);

const IGNORE_DIRS = new Set(["node_modules", ".git", "dist", "build", ".rumi"]);

/** List all scannable code files under a repo root (absolute-or-relative as given). */
export async function listCodeFiles(repoRoot: string): Promise<string[]> {
  return walk(repoRoot);
}

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

  // Analyze each file once into its real code tokens, with the analyzer chosen
  // by language. This is the seam where a deeper per-language analyzer plugs in.
  const tokensByFile = new Map<string, CodeTokens>();
  for (const file of files) {
    try {
      const text = await fs.readFile(file, "utf8");
      const analyzer = analyzerForExtension(path.extname(file));
      tokensByFile.set(path.relative(repoRoot, file), analyzer.analyze(text, file));
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
      for (const [file, tok] of tokensByFile) {
        if (signalMatches(signal, tok)) {
          hits++;
          matchedSignals.add(signal);
          matchedFiles.add(file);
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
