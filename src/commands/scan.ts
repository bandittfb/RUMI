/** `rumi scan` — read the three fields and report Collapse Potential. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadData } from "../core/load.js";
import { aggregateCorrections } from "../fields/correction.js";
import { scanCapacity } from "../fields/capacity.js";
import { aggregateUsage } from "../fields/utilization.js";
import { computeReadings, interpret } from "../core/collapse.js";
import { buildImportGraph } from "../fields/graph.js";
import { buildSymbolGraph } from "../fields/symbols.js";
import {
  integrationDistance,
  symbolIntegrationDistance,
  integrationLabel
} from "../fields/integration.js";
import type { ScanReport } from "../core/types.js";

const RUMI_DIR = ".rumi";

export interface ScanOptions {
  repo: string;
  data: string;
  json?: boolean;
  top?: number;
  quiet?: boolean;
}

export async function runScan(opts: ScanOptions): Promise<ScanReport> {
  const { capabilities, corrections, usage } = await loadData(opts.data);
  if (capabilities.length === 0) {
    throw new Error(
      `No capabilities found in ${path.join(opts.data, "capabilities.json")}. ` +
        `Define the capabilities RUMI should read across the three fields.`
    );
  }

  const correctionAgg = aggregateCorrections(corrections);
  const capacityEvidence = await scanCapacity(opts.repo, capabilities);
  const usageAgg = aggregateUsage(usage);

  const readings = computeReadings({
    capabilities,
    corrections: correctionAgg,
    capacity: capacityEvidence,
    usage: usageAgg
  });

  // Secondary observable: how far apart each capability's pieces are. Prefer the
  // symbol reference graph; fall back to the file import graph.
  const fileGraph = await buildImportGraph(opts.repo);
  const symbolGraph = await buildSymbolGraph(opts.repo);
  for (const r of readings) {
    const symbolD = symbolIntegrationDistance(r.evidence.matchedSignals, symbolGraph);
    r.integrationDistance =
      symbolD !== null ? symbolD : integrationDistance(r.evidence.capacityFiles, fileGraph);
  }

  const report: ScanReport = {
    generatedAt: new Date().toISOString(),
    repo: path.resolve(opts.repo),
    capabilityCount: capabilities.length,
    readings
  };

  await fs.mkdir(RUMI_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RUMI_DIR, "last-report.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  if (opts.quiet) {
    // no output
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printReport(report, opts.top ?? 10);
  }
  return report;
}

function bar(x: number): string {
  const n = Math.round(x * 10);
  return "#".repeat(n).padEnd(10, ".");
}

function printReport(report: ScanReport, top: number): void {
  const out = process.stdout;
  out.write("\n  RUMI - Revealed Uncollapsed Manifold Instrument\n");
  out.write(`  repo: ${report.repo}\n`);
  out.write(`  capabilities: ${report.capabilityCount}   generated: ${report.generatedAt}\n`);
  out.write("\n  Latent Affordance Candidates (ranked by Collapse Potential)\n");
  out.write("  -----------------------------------------------------------\n");

  const shown = report.readings.slice(0, top);
  for (const r of shown) {
    const uses = r.utilizationKnown ? `${r.evidence.usageCount} uses` : "usage unknown";
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      Collapse Potential : ${bar(r.collapsePotential)} ${r.collapsePotential.toFixed(3)}\n`);
    out.write(`      confidence         : ${bar(r.confidence)} ${r.confidence.toFixed(3)}${r.utilizationKnown ? "" : "   ⚠ usage unverified"}\n`);
    out.write(`      C  correction      : ${bar(r.correction)} ${r.correction.toFixed(3)}  (${r.evidence.correctionCount} events, coherence ${r.evidence.directionCoherence})\n`);
    out.write(`      K  capacity        : ${bar(r.capacity)} ${r.capacity.toFixed(3)}  (${r.evidence.matchedSignals.length} signals, ${r.evidence.capacityFiles.length} files)\n`);
    out.write(`      U  utilization     : ${bar(r.utilization)} ${r.utilization.toFixed(3)}  (${uses})\n`);
    const dLabel = integrationLabel(r.integrationDistance ?? null);
    if (dLabel && r.evidence.capacityFiles.length > 0) {
      const d = r.integrationDistance ?? 0;
      out.write(`      D  integration    : ${bar(d)} ${d.toFixed(3)}  ${dLabel}\n`);
    }
    out.write(`      -> ${interpret(r)}\n`);
  }
  out.write("\n  Saved full report to .rumi/last-report.json\n");
  out.write("  Run 'rumi dashboard' to explore candidates in the browser.\n\n");
}
