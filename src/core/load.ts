/** Loads RUMI input data (capabilities, corrections, usage) from a data dir. */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { CapabilityDef, CorrectionEvent, UsageEvent } from "./types.js";

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    const txt = await fs.readFile(file, "utf8");
    return JSON.parse(txt) as T;
  } catch {
    return fallback;
  }
}

export interface LoadedData {
  capabilities: CapabilityDef[];
  corrections: CorrectionEvent[];
  usage: UsageEvent[];
}

export async function loadData(dataDir: string): Promise<LoadedData> {
  const capabilities = await readJson<CapabilityDef[]>(
    path.join(dataDir, "capabilities.json"),
    []
  );
  const corrections = await readJson<CorrectionEvent[]>(
    path.join(dataDir, "corrections.json"),
    []
  );
  const usage = await readJson<UsageEvent[]>(path.join(dataDir, "usage.json"), []);
  return { capabilities, corrections, usage };
}
