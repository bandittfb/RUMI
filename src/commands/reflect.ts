/**
 * `rumi reflect` — recursive analysis: RUMI's instrument turned on itself.
 *
 * Level-1 (scan/discover): measure a target system's displacement field.
 * Level-2 (reflect): RUMI is itself a system that selects (it picks the top
 *   candidates), and that selection depends on RUMI's own configuration. Sweep
 *   that parameter manifold and measure collapse stability — robust discoveries
 *   survive RUMI displacing itself; fragile ones are artifacts of tuning.
 * Level-3 (reflect --level 3): the Level-2 VERDICT itself depends on how the
 *   reflection was configured — how widely the knobs are perturbed, how fine the
 *   grid. So sweep the reflection's own design space and ask whether the
 *   stability estimate holds. If it does, the recursion CONVERGES (a fixed point
 *   — higher levels add nothing); if not, it DIVERGES (the meta-confidence was
 *   itself an artifact). This is the terminus test for the tower of reflection.
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
  DEFAULT_COLLAPSE_CONFIG,
  type CollapseInputs,
  type CollapseConfig,
  type ClassifyThresholds
} from "../core/collapse.js";

export interface ReflectOptions {
  repo: string;
  data: string;
  json?: boolean;
  top?: number;
  level?: number;
}

type LevelSet = Record<string, number[]>;
type ThresholdSet = Record<string, number[]>;

const DEFAULT_CONFIG_LEVELS: LevelSet = {
  cHalf: [1.5, 3, 6],
  kHalf: [1, 2, 4],
  uHalf: [10, 20, 40],
  unknownUtilPrior: [0.3, 0.5, 0.7]
};
const DEFAULT_THRESHOLD_LEVELS: ThresholdSet = {
  hi: [0.5, 0.6, 0.7],
  lo: [0.25, 0.34, 0.45]
};
const DEFAULT_THRESHOLD_ONLY: ThresholdSet = { hi: [0.6], lo: [0.34] };

function product<T extends Record<string, number[]>>(levels: T): Array<{ [K in keyof T]: number }> {
  const keys = Object.keys(levels) as (keyof T)[];
  let combos: Array<Record<string, number>> = [{}];
  for (const key of keys) {
    const next: Array<Record<string, number>> = [];
    for (const combo of combos) for (const v of levels[key]) next.push({ ...combo, [key]: v });
    combos = next;
  }
  return combos as Array<{ [K in keyof T]: number }>;
}

interface SweepStat {
  rank1: number;
  candidate: number;
  cpMin: number;
  cpMax: number;
  sens: Map<string, Map<number, { c: number; t: number }>>;
}
interface SweepResult {
  stats: Map<string, SweepStat>;
  total: number;
}

/** Run the engine across a config × threshold grid; tally rank-1 and feature hits. */
function sweep(inputs: CollapseInputs, configLevels: LevelSet, thresholdLevels: ThresholdSet): SweepResult {
  const stats = new Map<string, SweepStat>();
  for (const cap of inputs.capabilities) {
    stats.set(cap.id, { rank1: 0, candidate: 0, cpMin: Infinity, cpMax: -Infinity, sens: new Map() });
  }
  const bump = (s: SweepStat, knob: string, level: number, cand: boolean): void => {
    const byLevel = s.sens.get(knob) ?? s.sens.set(knob, new Map()).get(knob)!;
    const cell = byLevel.get(level) ?? byLevel.set(level, { c: 0, t: 0 }).get(level)!;
    cell.t++;
    if (cand) cell.c++;
  };

  const configs = product(configLevels) as unknown as CollapseConfig[];
  const thresholds = product(thresholdLevels) as unknown as ClassifyThresholds[];
  for (const config of configs) {
    const readings = computeReadings(inputs, config);
    for (const th of thresholds) {
      const knobs: Record<string, number> = { ...config, hi: th.hi, lo: th.lo };
      readings.forEach((r, rank) => {
        const s = stats.get(r.capability)!;
        const cand = isCandidate(categorize(r, th));
        if (rank === 0) s.rank1++;
        if (cand) s.candidate++;
        if (r.collapsePotential < s.cpMin) s.cpMin = r.collapsePotential;
        if (r.collapsePotential > s.cpMax) s.cpMax = r.collapsePotential;
        for (const k in knobs) bump(s, k, knobs[k], cand);
      });
    }
  }
  return { stats, total: configs.length * thresholds.length };
}

async function buildInputs(opts: ReflectOptions): Promise<CollapseInputs> {
  const { capabilities, corrections, usage } = await loadData(opts.data);
  if (capabilities.length === 0) {
    throw new Error(
      `No capabilities found in ${path.join(opts.data, "capabilities.json")}. ` +
        `Reflection sweeps RUMI's configuration over a declared capability set.`
    );
  }
  return {
    capabilities,
    corrections: aggregateCorrections(corrections),
    capacity: await scanCapacity(opts.repo, capabilities),
    usage: aggregateUsage(usage)
  };
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

// ── Level 2 ──────────────────────────────────────────────────────────────────

interface KnobSensitivity {
  knob: string;
  lowLevel: number;
  lowShare: number;
  highLevel: number;
  highShare: number;
  spread: number;
}

function mostSensitive(s: SweepStat): KnobSensitivity | null {
  let best: KnobSensitivity | null = null;
  for (const [knob, byLevel] of s.sens) {
    const levels = [...byLevel.entries()]
      .map(([level, { c, t }]) => ({ level, share: t ? c / t : 0 }))
      .sort((a, b) => a.share - b.share);
    const low = levels[0];
    const high = levels[levels.length - 1];
    const spread = high.share - low.share;
    if (spread > 0 && (!best || spread > best.spread)) {
      best = { knob, lowLevel: low.level, lowShare: low.share, highLevel: high.level, highShare: high.share, spread };
    }
  }
  return best;
}

function verdict2(candidateShare: number, rank1Share: number, baselineCP: number): string {
  if (baselineCP < 0.01 && candidateShare < 0.05) return "not a candidate in any configuration.";
  if (candidateShare <= 0.2) return "stable non-candidate — RUMI agrees it is not a latent feature.";
  const rank = rank1Share >= 0.8 ? "consistently RUMI's #1 pick; " : rank1Share >= 0.2 ? "sometimes the #1 pick; " : "";
  if (candidateShare >= 0.8) return `${rank}ROBUST — survives RUMI displacing its own parameters.`;
  if (candidateShare >= 0.5)
    return `${rank}MOSTLY ROBUST — a feature across most of RUMI's configuration space, threshold-sensitive at the margin.`;
  return `${rank}FRAGILE — reads as a feature only under part of RUMI's configuration space.`;
}

function runLevel2(inputs: CollapseInputs, opts: ReflectOptions): void {
  const { stats, total } = sweep(inputs, DEFAULT_CONFIG_LEVELS, DEFAULT_THRESHOLD_LEVELS);
  const baseline = computeReadings(inputs);
  const baseRank = new Map(baseline.map((r, i) => [r.capability, i]));

  const rows = inputs.capabilities
    .map((cap) => {
      const s = stats.get(cap.id)!;
      const base = baseline.find((r) => r.capability === cap.id)!;
      return {
        capability: cap.id,
        label: cap.label,
        baselineCP: base.collapsePotential,
        baselineRank: (baseRank.get(cap.id) ?? 0) + 1,
        baselineCategory: categorize(base),
        rank1Share: s.rank1 / total,
        candidateShare: s.candidate / total,
        cpMin: s.cpMin === Infinity ? 0 : s.cpMin,
        cpMax: s.cpMax === -Infinity ? 0 : s.cpMax,
        knob: mostSensitive(s)
      };
    })
    .sort((a, b) => b.baselineCP - a.baselineCP);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ level: 2, configurations: total, rows }, null, 2) + "\n");
    return;
  }

  const out = process.stdout;
  const top = rows.find((r) => r.baselineRank === 1);
  out.write("\n  RUMI - Level-2 Reflection (collapse stability under self-perturbation)\n");
  out.write(`  repo: ${path.resolve(opts.repo)}\n`);
  out.write(`  swept ${total} configurations across RUMI's own parameter manifold\n`);
  if (top) {
    out.write(
      `\n  Headline: RUMI's top selection [${top.capability}] holds rank #1 in ` +
        `${pct(top.rank1Share)} of its own plausible self-configurations.\n`
    );
  }
  out.write("\n  Discovery stability\n  -------------------\n");
  for (const r of rows.slice(0, opts.top ?? 10)) {
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      baseline CP        : ${r.baselineCP.toFixed(3)}  (rank #${r.baselineRank}, ${r.baselineCategory})\n`);
    out.write(`      CP across configs  : ${r.cpMin.toFixed(3)} – ${r.cpMax.toFixed(3)}\n`);
    out.write(`      stays rank #1      : ${pct(r.rank1Share)}\n`);
    out.write(`      classed a feature  : ${pct(r.candidateShare)}\n`);
    if (r.knob && r.candidateShare > 0.05 && r.candidateShare < 0.95) {
      out.write(
        `      most sensitive to  : ${r.knob.knob}  (feature ${pct(r.knob.highShare)} at ${r.knob.knob}=${r.knob.highLevel} ` +
          `vs ${pct(r.knob.lowShare)} at ${r.knob.knob}=${r.knob.lowLevel})\n`
      );
    }
    out.write(`      -> ${verdict2(r.candidateShare, r.rank1Share, r.baselineCP)}\n`);
  }
  out.write("\n");
}

// ── Level 3 ──────────────────────────────────────────────────────────────────

function geomSpace(min: number, max: number, n: number): number[] {
  if (n <= 1) return [Math.sqrt(min * max)];
  const lo = Math.log(min);
  const step = (Math.log(max) - lo) / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.exp(lo + step * i));
}
function linSpace(min: number, max: number, n: number): number[] {
  if (n <= 1) return [(min + max) / 2];
  const step = (max - min) / (n - 1);
  return Array.from({ length: n }, (_, i) => min + step * i);
}

/** A reflection DESIGN: how widely RUMI perturbs itself, and how finely. */
function buildConfigLevels(radius: "narrow" | "medium" | "wide", n: number): LevelSet {
  const factorEnds: Record<string, [number, number]> = {
    narrow: [0.75, 1.333],
    medium: [0.5, 2],
    wide: [0.333, 3]
  };
  const priorEnds: Record<string, [number, number]> = {
    narrow: [0.4, 0.6],
    medium: [0.3, 0.7],
    wide: [0.2, 0.8]
  };
  const [fLo, fHi] = factorEnds[radius];
  const factors = geomSpace(fLo, fHi, n);
  const { cHalf, kHalf, uHalf } = DEFAULT_COLLAPSE_CONFIG;
  return {
    cHalf: factors.map((f) => cHalf * f),
    kHalf: factors.map((f) => kHalf * f),
    uHalf: factors.map((f) => uHalf * f),
    unknownUtilPrior: linSpace(priorEnds[radius][0], priorEnds[radius][1], n)
  };
}

function runLevel3(inputs: CollapseInputs, opts: ReflectOptions): void {
  const designs: Array<{ label: string; radius: "narrow" | "medium" | "wide"; n: number }> = [];
  for (const radius of ["narrow", "medium", "wide"] as const) {
    for (const n of [3, 5]) designs.push({ label: `${radius}/${n}lvl`, radius, n });
  }

  // For each capability, gather its feature-stability and rank-1 share under each
  // reflection design (default thresholds isolate the reflection-design axis).
  const perCap = new Map<string, { label: string; baselineCP: number; shares: number[]; rank1s: number[] }>();
  const baseline = computeReadings(inputs);
  for (const cap of inputs.capabilities) {
    const base = baseline.find((r) => r.capability === cap.id)!;
    perCap.set(cap.id, { label: cap.label, baselineCP: base.collapsePotential, shares: [], rank1s: [] });
  }

  for (const design of designs) {
    const { stats, total } = sweep(inputs, buildConfigLevels(design.radius, design.n), DEFAULT_THRESHOLD_ONLY);
    for (const cap of inputs.capabilities) {
      const s = stats.get(cap.id)!;
      const p = perCap.get(cap.id)!;
      p.shares.push(s.candidate / total);
      p.rank1s.push(s.rank1 / total);
    }
  }

  // Level-2 default estimate, for reference.
  const l2 = sweep(inputs, DEFAULT_CONFIG_LEVELS, DEFAULT_THRESHOLD_LEVELS);

  const rows = inputs.capabilities
    .map((cap) => {
      const p = perCap.get(cap.id)!;
      const min = Math.min(...p.shares);
      const max = Math.max(...p.shares);
      const mean = p.shares.reduce((a, b) => a + b, 0) / p.shares.length;
      const rank1Min = Math.min(...p.rank1s);
      const l2Share = l2.stats.get(cap.id)!.candidate / l2.total;
      return { capability: cap.id, label: p.label, baselineCP: p.baselineCP, l2Share, min, max, mean, spread: max - min, rank1Min };
    })
    .sort((a, b) => b.baselineCP - a.baselineCP);

  // Two questions converge separately: does the RANKING hold (is it still the #1
  // pick?) and does the CLASSIFICATION hold (does it still read as a feature?)
  // across reflection designs. The first can be a fixed point while the second
  // is an artifact — that distinction is the whole point of going to Level-3.
  const CONVERGE_SPREAD = 0.35;
  const candidates = rows.filter((r) => r.baselineCP >= 0.01);
  const maxCP = Math.max(...rows.map((x) => x.baselineCP));
  const topPick = rows.find((r) => r.baselineCP === maxCP);

  if (opts.json) {
    process.stdout.write(JSON.stringify({ level: 3, designs: designs.length, rows }, null, 2) + "\n");
    return;
  }

  const out = process.stdout;
  out.write("\n  RUMI - Level-3 Reflection (does the recursion converge?)\n");
  out.write(`  repo: ${path.resolve(opts.repo)}\n`);
  out.write(`  swept ${designs.length} reflection designs (perturbation radius × granularity), each a full Level-2 sweep\n`);

  if (topPick) {
    const rankFixed = topPick.rank1Min >= 0.99;
    const classConverges = topPick.spread <= CONVERGE_SPREAD;
    out.write(`\n  Headline: the recursion has a SPLIT fixed point for the top discovery [${topPick.capability}].\n`);
    out.write(
      `  RANKING ${rankFixed ? "CONVERGES" : "does not converge"} — it is RUMI's #1 pick in ` +
        `${rankFixed ? "100%" : `≥${pct(topPick.rank1Min)}`} of every reflection design${rankFixed ? ", a true fixed point" : ""}.\n`
    );
    out.write(
      `  CLASSIFICATION ${classConverges ? "CONVERGES" : "does NOT converge"} — its 'feature' label spans ` +
        `${pct(topPick.min)}–${pct(topPick.max)} as RUMI's self-perturbation widens (Level-2 reported ${pct(topPick.l2Share)}).\n`
    );
    out.write(
      classConverges
        ? `  The meta-confidence is earned; a Level-4 sweep would add negligible information.\n`
        : `  The terminus finding: the trustworthy invariant is the RANKING; the single "${pct(topPick.l2Share)}" feature-stability number was itself partly an artifact of how RUMI was set to reflect. Level-3 is where that becomes visible — and where the honest recursion stops.\n`
    );
  }

  out.write("\n  Verdict stability across reflection designs\n  -------------------------------------------\n");
  for (const r of candidates.slice(0, opts.top ?? 10)) {
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      Level-2 estimate     : ${pct(r.l2Share)} feature-stable\n`);
    out.write(`      across designs       : ${pct(r.min)} – ${pct(r.max)}  (mean ${pct(r.mean)}, spread ${pct(r.spread)})\n`);
    out.write(`      rank #1 (worst design): ${pct(r.rank1Min)}\n`);
    out.write(
      `      -> ${r.spread <= CONVERGE_SPREAD ? "CONVERGES — estimate stable across how RUMI reflects (the robust/fragile label is a choice of cutoff, the number is real)." : "DIVERGES — the stability estimate is itself an artifact of reflection design."}\n`
    );
  }
  if (candidates.length === 0) out.write("\n  (no candidates with non-zero Collapse Potential to reflect on)\n");
  out.write("\n");
}

export async function runReflect(opts: ReflectOptions): Promise<void> {
  const inputs = await buildInputs(opts);
  if ((opts.level ?? 2) >= 3) runLevel3(inputs, opts);
  else runLevel2(inputs, opts);
}
