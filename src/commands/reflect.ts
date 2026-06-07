/**
 * `rumi reflect` — Level-2 analysis: RUMI's instrument turned on itself.
 *
 * Level-1 RUMI measures a target system's displacement field: a system selects,
 * that selection displaces alternatives, and the displaced field reveals latent
 * features. But RUMI is *itself* a system that makes a selection — it picks the
 * top candidates to surface — and that selection depends on RUMI's own arbitrary
 * configuration (the saturation scales, the unknown-usage prior, the
 * classification thresholds). Those are RUMI's degrees of freedom.
 *
 * Reflection sweeps that parameter manifold, re-running the engine at each point,
 * and measures COLLAPSE STABILITY: does a candidate stay the top pick / stay
 * classified an uncollapsed feature as RUMI displaces its own parameters?
 *
 *   robust   — the discovery survives RUMI's self-displacement (real)
 *   fragile  — it wins only under the current tuning (an artifact of configuration)
 *
 * This is the recursion: RUMI's core move — examine the field a selection
 * displaces — applied to RUMI's own selection. It yields a meta-confidence no
 * single Level-1 reading can.
 */
import path from "node:path";
import { loadData } from "../core/load.js";
import { aggregateCorrections } from "../fields/correction.js";
import { scanCapacity } from "../fields/capacity.js";
import { aggregateUsage } from "../fields/utilization.js";
import {
  computeReadings,
  categorize,
  isCandidate,
  type CollapseConfig,
  type ClassifyThresholds
} from "../core/collapse.js";

export interface ReflectOptions {
  repo: string;
  data: string;
  json?: boolean;
  top?: number;
}

// RUMI's degrees of freedom, each sampled low / default / high.
const CONFIG_LEVELS = {
  cHalf: [1.5, 3, 6],
  kHalf: [1, 2, 4],
  uHalf: [10, 20, 40],
  unknownUtilPrior: [0.3, 0.5, 0.7]
};
const THRESHOLD_LEVELS = {
  hi: [0.5, 0.6, 0.7],
  lo: [0.25, 0.34, 0.45]
};

interface KnobSensitivity {
  knob: string;
  lowLevel: number;
  lowShare: number;
  highLevel: number;
  highShare: number;
  spread: number;
}

interface Stability {
  capability: string;
  label: string;
  baselineCP: number;
  baselineRank: number;
  baselineCategory: string;
  rank1Share: number;
  top3Share: number;
  candidateShare: number;
  cpMin: number;
  cpMax: number;
  mostSensitiveKnob: KnobSensitivity | null;
}

interface ReflectReport {
  generatedAt: string;
  repo: string;
  configurations: number;
  topPick: { capability: string; label: string; rank1Share: number } | null;
  stability: Stability[];
}

function product<T extends Record<string, number[]>>(levels: T): Array<{ [K in keyof T]: number }> {
  const keys = Object.keys(levels) as (keyof T)[];
  let combos: Array<Record<string, number>> = [{}];
  for (const key of keys) {
    const next: Array<Record<string, number>> = [];
    for (const combo of combos) {
      for (const value of levels[key]) next.push({ ...combo, [key]: value });
    }
    combos = next;
  }
  return combos as Array<{ [K in keyof T]: number }>;
}

export async function runReflect(opts: ReflectOptions): Promise<ReflectReport> {
  const { capabilities, corrections, usage } = await loadData(opts.data);
  if (capabilities.length === 0) {
    throw new Error(
      `No capabilities found in ${path.join(opts.data, "capabilities.json")}. ` +
        `Reflection sweeps RUMI's configuration over a declared capability set.`
    );
  }

  // Field aggregates are parameter-independent — compute once, re-score many times.
  const inputs = {
    capabilities,
    corrections: aggregateCorrections(corrections),
    capacity: await scanCapacity(opts.repo, capabilities),
    usage: aggregateUsage(usage)
  };

  const configs = product(CONFIG_LEVELS) as CollapseConfig[];
  const thresholds = product(THRESHOLD_LEVELS) as ClassifyThresholds[];
  const totalRuns = configs.length * thresholds.length;

  // Accumulators per capability. `sens` counts candidate-classifications by knob
  // value, so we can attribute classification fragility to a specific knob.
  interface Acc {
    rank1: number;
    top3: number;
    candidate: number;
    cpMin: number;
    cpMax: number;
    sens: Map<string, Map<number, { c: number; t: number }>>;
  }
  const acc = new Map<string, Acc>();
  for (const cap of capabilities) {
    acc.set(cap.id, { rank1: 0, top3: 0, candidate: 0, cpMin: Infinity, cpMax: -Infinity, sens: new Map() });
  }
  const bumpSens = (a: Acc, knob: string, level: number, cand: boolean): void => {
    const byLevel = a.sens.get(knob) ?? a.sens.set(knob, new Map()).get(knob)!;
    const cell = byLevel.get(level) ?? byLevel.set(level, { c: 0, t: 0 }).get(level)!;
    cell.t++;
    if (cand) cell.c++;
  };

  for (const config of configs) {
    const readings = computeReadings(inputs, config); // sorted by CP desc
    for (const th of thresholds) {
      const knobValues: Record<string, number> = { ...config, hi: th.hi, lo: th.lo };
      readings.forEach((r, rank) => {
        const a = acc.get(r.capability)!;
        const cand = isCandidate(categorize(r, th));
        if (rank === 0) a.rank1++;
        if (rank < 3) a.top3++;
        if (cand) a.candidate++;
        if (r.collapsePotential < a.cpMin) a.cpMin = r.collapsePotential;
        if (r.collapsePotential > a.cpMax) a.cpMax = r.collapsePotential;
        for (const knob in knobValues) bumpSens(a, knob, knobValues[knob], cand);
      });
    }
  }

  const mostSensitive = (a: Acc): KnobSensitivity | null => {
    let best: KnobSensitivity | null = null;
    for (const [knob, byLevel] of a.sens) {
      const levels = [...byLevel.entries()]
        .map(([level, { c, t }]) => ({ level, share: t ? c / t : 0 }))
        .sort((x, y) => x.share - y.share);
      const low = levels[0];
      const high = levels[levels.length - 1];
      const spread = high.share - low.share;
      if (spread > 0 && (!best || spread > best.spread)) {
        best = { knob, lowLevel: low.level, lowShare: low.share, highLevel: high.level, highShare: high.share, spread };
      }
    }
    return best;
  };

  // Baseline reading (default config + default thresholds) for reference rank/CP.
  const baseline = computeReadings(inputs);
  const baseRank = new Map(baseline.map((r, i) => [r.capability, i]));

  const stability: Stability[] = capabilities
    .map((cap) => {
      const a = acc.get(cap.id)!;
      const base = baseline.find((r) => r.capability === cap.id)!;
      return {
        capability: cap.id,
        label: cap.label,
        baselineCP: base.collapsePotential,
        baselineRank: (baseRank.get(cap.id) ?? 0) + 1,
        baselineCategory: categorize(base),
        rank1Share: a.rank1 / totalRuns,
        top3Share: a.top3 / totalRuns,
        candidateShare: a.candidate / totalRuns,
        cpMin: a.cpMin === Infinity ? 0 : a.cpMin,
        cpMax: a.cpMax === -Infinity ? 0 : a.cpMax,
        mostSensitiveKnob: mostSensitive(a)
      };
    })
    .sort((x, y) => y.baselineCP - x.baselineCP);

  const top = stability.find((s) => s.baselineRank === 1) ?? null;
  const report: ReflectReport = {
    generatedAt: new Date().toISOString(),
    repo: path.resolve(opts.repo),
    configurations: totalRuns,
    topPick: top ? { capability: top.capability, label: top.label, rank1Share: top.rank1Share } : null,
    stability
  };

  if (opts.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    printReflect(report, opts.top ?? 10);
  }
  return report;
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function verdict(s: Stability): string {
  if (s.baselineCP < 0.01 && s.candidateShare < 0.05) {
    return "not a candidate in any configuration.";
  }
  if (s.candidateShare <= 0.2) {
    return "stable non-candidate — RUMI agrees it is not a latent feature.";
  }
  const rankPrefix =
    s.rank1Share >= 0.8 ? "consistently RUMI's #1 pick; " : s.rank1Share >= 0.2 ? "sometimes the #1 pick; " : "";
  if (s.candidateShare >= 0.8) return `${rankPrefix}ROBUST — survives RUMI displacing its own parameters.`;
  if (s.candidateShare >= 0.5)
    return `${rankPrefix}MOSTLY ROBUST — a feature across most of RUMI's configuration space, threshold-sensitive at the margin.`;
  return `${rankPrefix}FRAGILE — reads as a feature only under part of RUMI's configuration space.`;
}

function printReflect(report: ReflectReport, top: number): void {
  const out = process.stdout;
  out.write("\n  RUMI - Level-2 Reflection (collapse stability under self-perturbation)\n");
  out.write(`  repo: ${report.repo}\n`);
  out.write(`  swept ${report.configurations} configurations across RUMI's own parameter manifold\n`);
  if (report.topPick) {
    out.write(
      `\n  Headline: RUMI's top selection [${report.topPick.capability}] holds rank #1 in ` +
        `${pct(report.topPick.rank1Share)} of its own plausible self-configurations.\n`
    );
  }
  out.write("\n  Discovery stability\n");
  out.write("  -------------------\n");

  for (const s of report.stability.slice(0, top)) {
    out.write(`\n  > ${s.label}  [${s.capability}]\n`);
    out.write(`      baseline CP        : ${s.baselineCP.toFixed(3)}  (rank #${s.baselineRank}, ${s.baselineCategory})\n`);
    out.write(`      CP across configs  : ${s.cpMin.toFixed(3)} – ${s.cpMax.toFixed(3)}\n`);
    out.write(`      stays rank #1      : ${pct(s.rank1Share)}\n`);
    out.write(`      classed a feature  : ${pct(s.candidateShare)}\n`);
    const k = s.mostSensitiveKnob;
    if (k && s.candidateShare > 0.05 && s.candidateShare < 0.95) {
      out.write(
        `      most sensitive to  : ${k.knob}  (feature ${pct(k.highShare)} at ${k.knob}=${k.highLevel} ` +
          `vs ${pct(k.lowShare)} at ${k.knob}=${k.lowLevel})\n`
      );
    }
    out.write(`      -> ${verdict(s)}\n`);
  }
  out.write("\n");
}
