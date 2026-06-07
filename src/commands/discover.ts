/**
 * `rumi discover` — the divining rod in action.
 *
 * Unlike `scan`, this command is given NO capabilities.json. It proposes the
 * capabilities itself from the correction field, derives their capacity signals,
 * scans the repo, and runs the ordinary collapse engine — surfacing emergent,
 * undeclared capabilities ranked by Collapse Potential, each with confidence.
 *
 * Because a proposed capability has no usage record, its utilization is unknown
 * by construction (F1): every emergent candidate is therefore a lead to verify,
 * never a conclusion to act on.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { loadData } from "../core/load.js";
import { proposeCapabilities } from "../fields/propose.js";
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
import type { FieldReading } from "../core/types.js";

const RUMI_DIR = ".rumi";

export interface DiscoverOptions {
  repo: string;
  data: string;
  json?: boolean;
  top?: number;
  quiet?: boolean;
}

export interface DiscoveryReport {
  generatedAt: string;
  repo: string;
  correctionCount: number;
  proposedCount: number;
  readings: Array<FieldReading & { signals: string[]; memberIds: string[] }>;
}

export async function runDiscover(opts: DiscoverOptions): Promise<DiscoveryReport> {
  const { corrections, usage } = await loadData(opts.data);
  if (corrections.length === 0) {
    throw new Error(
      `No corrections found in ${path.join(opts.data, "corrections.json")}. ` +
        `Discovery proposes capabilities from the correction field — it needs corrections to read.`
    );
  }

  const proposed = proposeCapabilities(corrections);
  const defs = proposed.map((p) => p.def);

  // Reassign each correction to its proposed cluster, then run the normal engine.
  const eventToCluster = new Map<string, string>();
  for (const p of proposed) {
    for (const id of p.memberIds) eventToCluster.set(id, p.def.id);
  }
  const clusteredCorrections = corrections
    .filter((e) => eventToCluster.has(e.id))
    .map((e) => ({ ...e, capability: eventToCluster.get(e.id)! }));

  const correctionAgg = aggregateCorrections(clusteredCorrections);
  const capacityEvidence = await scanCapacity(opts.repo, defs);
  // Usage is keyed by real capability ids and will not match proposed ids — so
  // every emergent capability's utilization is unknown, which is the honest state.
  const usageAgg = aggregateUsage(usage);

  const readings = computeReadings({
    capabilities: defs,
    corrections: correctionAgg,
    capacity: capacityEvidence,
    usage: usageAgg
  });

  const fileGraph = await buildImportGraph(opts.repo);
  const symbolGraph = await buildSymbolGraph(opts.repo);
  for (const r of readings) {
    const symbolD = symbolIntegrationDistance(r.evidence.matchedSignals, symbolGraph);
    r.integrationDistance =
      symbolD !== null ? symbolD : integrationDistance(r.evidence.capacityFiles, fileGraph);
  }

  const signalsById = new Map(proposed.map((p) => [p.def.id, p.def.signals]));
  const membersById = new Map(proposed.map((p) => [p.def.id, p.memberIds]));
  const enriched = readings.map((r) => ({
    ...r,
    signals: signalsById.get(r.capability) ?? [],
    memberIds: membersById.get(r.capability) ?? []
  }));

  const report: DiscoveryReport = {
    generatedAt: new Date().toISOString(),
    repo: path.resolve(opts.repo),
    correctionCount: corrections.length,
    proposedCount: proposed.length,
    readings: enriched
  };

  await fs.mkdir(RUMI_DIR, { recursive: true });
  await fs.writeFile(
    path.join(RUMI_DIR, "last-discovery.json"),
    JSON.stringify(report, null, 2),
    "utf8"
  );

  if (opts.quiet) {
    // no output — caller consumes the returned report
  } else if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printDiscovery(report, opts.top ?? 10);
  }
  return report;
}

function bar(x: number): string {
  return "#".repeat(Math.round(x * 10)).padEnd(10, ".");
}

function printDiscovery(report: DiscoveryReport, top: number): void {
  const out = process.stdout;
  out.write("\n  RUMI - Emergent Capability Discovery\n");
  out.write(`  repo: ${report.repo}\n`);
  out.write(
    `  read ${report.correctionCount} corrections (no capabilities declared) -> ` +
      `proposed ${report.proposedCount} emergent capabilities\n`
  );
  out.write("\n  Emergent Capabilities (proposed from the correction field)\n");
  out.write("  ----------------------------------------------------------\n");

  for (const r of report.readings.slice(0, top)) {
    const uses = r.utilizationKnown ? `${r.evidence.usageCount} uses` : "usage unknown";
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      proposed signals   : ${r.signals.join(", ")}\n`);
    out.write(`      Collapse Potential : ${bar(r.collapsePotential)} ${r.collapsePotential.toFixed(3)}\n`);
    out.write(`      confidence         : ${bar(r.confidence)} ${r.confidence.toFixed(3)}${r.utilizationKnown ? "" : "   ⚠ usage unverified"}\n`);
    out.write(`      C  correction      : ${bar(r.correction)} ${r.correction.toFixed(3)}  (${r.evidence.correctionCount} signals, coherence ${r.evidence.directionCoherence})\n`);
    if (r.evidence.correctionCount > 0 && r.evidence.arrowShare < 0.999) {
      out.write(`      demand mix         : ${Math.round(r.evidence.arrowShare * 100)}% directional · ${Math.round((1 - r.evidence.arrowShare) * 100)}% heat (direction uncertain)\n`);
    }
    out.write(`      K  capacity        : ${bar(r.capacity)} ${r.capacity.toFixed(3)}  (${r.evidence.matchedSignals.length} signals, ${r.evidence.capacityFiles.length} files)\n`);
    out.write(`      U  utilization     : ${bar(r.utilization)} ${r.utilization.toFixed(3)}  (${uses})\n`);
    if (r.evidence.capacityFiles.length) {
      out.write(`      capacity in        : ${r.evidence.capacityFiles.join(", ")}\n`);
    }
    const dLabel = integrationLabel(r.integrationDistance ?? null);
    if (dLabel && r.evidence.capacityFiles.length > 0) {
      const d = r.integrationDistance ?? 0;
      out.write(`      D  integration    : ${bar(d)} ${d.toFixed(3)}  ${dLabel}\n`);
    }
    out.write(`      -> ${interpret(r)}\n`);
  }
  out.write("\n  Saved full discovery to .rumi/last-discovery.json\n\n");
}
