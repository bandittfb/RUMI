/**
 * `rumi experiment baseline` and `rumi experiment compare`.
 *
 * The instrument should not stop at discovery — it should verify collapse.
 * A baseline snapshots the field today. After you ship a change, `compare`
 * shows whether correction pressure decayed, utilization rose, and Collapse
 * Potential actually fell — i.e. whether the latent affordance collapsed into
 * a real, used workflow.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { runScan } from "./scan.js";
import type { Baseline, ScanReport } from "../core/types.js";

const RUMI_DIR = ".rumi";
const BASELINE_FILE = path.join(RUMI_DIR, "baseline.json");

function toBaseline(report: ScanReport): Baseline {
  const field: Baseline["field"] = {};
  for (const r of report.readings) {
    field[r.capability] = {
      correction: r.correction,
      capacity: r.capacity,
      utilization: r.utilization,
      collapsePotential: r.collapsePotential
    };
  }
  return { savedAt: report.generatedAt, field };
}

export async function runBaseline(opts: { repo: string; data: string }): Promise<void> {
  const report = await runScan({ ...opts, quiet: true });
  const baseline = toBaseline(report);
  await fs.mkdir(RUMI_DIR, { recursive: true });
  await fs.writeFile(BASELINE_FILE, JSON.stringify(baseline, null, 2), "utf8");
  process.stdout.write(`\n  Baseline saved to ${BASELINE_FILE} (${Object.keys(baseline.field).length} capabilities).\n`);
  process.stdout.write("  Ship a change, then run `rumi experiment compare` to check for collapse.\n\n");
}

export async function runCompare(opts: { repo: string; data: string }): Promise<void> {
  let baseline: Baseline;
  try {
    baseline = JSON.parse(await fs.readFile(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    throw new Error(`No baseline found at ${BASELINE_FILE}. Run \`rumi experiment baseline\` first.`);
  }

  const report = await runScan({ ...opts, quiet: true });
  const now = toBaseline(report);

  process.stdout.write(`\n  Collapse check — baseline ${baseline.savedAt} → now ${now.savedAt}\n`);
  process.stdout.write("  ───────────────────────────────────────────────────────────\n");

  const caps = Object.keys(now.field);
  caps.sort((a, b) => deltaCP(baseline, now, b) - deltaCP(baseline, now, a));

  for (const cap of caps) {
    const before = baseline.field[cap];
    const after = now.field[cap];
    if (!before) continue;
    const dCP = after.collapsePotential - before.collapsePotential;
    const dU = after.utilization - before.utilization;
    const dC = after.correction - before.correction;
    const verdict =
      dCP <= -0.1 && dU > 0
        ? "COLLAPSED ✓ (pressure fell, usage rose)"
        : dCP <= -0.1
        ? "decaying (pressure fell)"
        : dCP >= 0.1
        ? "intensifying (pressure rose)"
        : "stable";
    process.stdout.write(
      `\n  ▸ ${cap}\n` +
        `      ΔCollapse ${fmt(dCP)}   ΔC ${fmt(dC)}   ΔU ${fmt(dU)}   ${verdict}\n`
    );
  }
  process.stdout.write("\n");
}

function deltaCP(b: Baseline, n: Baseline, cap: string): number {
  const before = b.field[cap]?.collapsePotential ?? 0;
  const after = n.field[cap]?.collapsePotential ?? 0;
  return Math.abs(after - before);
}

function fmt(x: number): string {
  const s = x >= 0 ? "+" : "";
  return (s + x.toFixed(3)).padStart(7);
}
