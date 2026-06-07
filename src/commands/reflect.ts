/**
 * `rumi reflect` — recursive analysis: RUMI's instrument turned on itself.
 *
 * Level-1 (scan/discover): measure a target system's displacement field.
 * Level-2 (reflect): RUMI is itself a system that selects (it picks the top
 *   candidates), and that selection depends on RUMI's own configuration. Sweep
 *   that parameter manifold and measure collapse stability — robust discoveries
 *   survive RUMI displacing itself; fragile ones are artifacts of tuning.
 * Level-3 (reflect --level 3): the Level-2 VERDICT itself depends on how the
 *   reflection was configured. Sweep the reflection's own design space and ask
 *   whether the stability estimate holds. If it does, the recursion CONVERGES (a
 *   fixed point); if not, it DIVERGES (the meta-confidence was itself an
 *   artifact). The terminus test for the tower of reflection.
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
  type ClassifyThresholds,
  type Category
} from "../core/collapse.js";

export interface ReflectOptions {
  repo: string;
  data: string;
  json?: boolean;
  top?: number;
  level?: number;
}

type LevelSet = Record<string, number[]>;

const DEFAULT_CONFIG_LEVELS: LevelSet = {
  cHalf: [1.5, 3, 6],
  kHalf: [1, 2, 4],
  uHalf: [10, 20, 40],
  unknownUtilPrior: [0.3, 0.5, 0.7]
};
const DEFAULT_THRESHOLD_LEVELS: LevelSet = {
  hi: [0.5, 0.6, 0.7],
  lo: [0.25, 0.34, 0.45]
};
const DEFAULT_THRESHOLD_ONLY: LevelSet = { hi: [0.6], lo: [0.34] };
const CONVERGE_SPREAD = 0.35;

function product(levels: LevelSet): Array<Record<string, number>> {
  const keys = Object.keys(levels);
  let combos: Array<Record<string, number>> = [{}];
  for (const key of keys) {
    const next: Array<Record<string, number>> = [];
    for (const combo of combos) for (const v of levels[key]) next.push({ ...combo, [key]: v });
    combos = next;
  }
  return combos;
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

function sweep(inputs: CollapseInputs, configLevels: LevelSet, thresholdLevels: LevelSet): SweepResult {
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

export async function buildInputs(opts: { repo: string; data: string }): Promise<CollapseInputs> {
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

// ── Compute (pure, returns serializable data for CLI and dashboard) ───────────

export interface KnobSensitivity {
  knob: string;
  lowLevel: number;
  lowShare: number;
  highLevel: number;
  highShare: number;
}
export interface Level2Row {
  capability: string;
  label: string;
  baselineCP: number;
  baselineRank: number;
  baselineCategory: Category;
  rank1Share: number;
  candidateShare: number;
  cpMin: number;
  cpMax: number;
  mostSensitiveKnob: KnobSensitivity | null;
}
export interface Level3Row {
  capability: string;
  label: string;
  baselineCP: number;
  l2Share: number;
  min: number;
  max: number;
  mean: number;
  spread: number;
  rank1Min: number;
  classConverges: boolean;
}

function mostSensitive(s: SweepStat): KnobSensitivity | null {
  let best: KnobSensitivity | null = null;
  let bestSpread = 0;
  for (const [knob, byLevel] of s.sens) {
    const levels = [...byLevel.entries()]
      .map(([level, { c, t }]) => ({ level, share: t ? c / t : 0 }))
      .sort((a, b) => a.share - b.share);
    const low = levels[0];
    const high = levels[levels.length - 1];
    const spread = high.share - low.share;
    if (spread > 0 && (!best || spread > bestSpread)) {
      bestSpread = spread;
      best = { knob, lowLevel: low.level, lowShare: low.share, highLevel: high.level, highShare: high.share };
    }
  }
  return best;
}

export function computeLevel2(inputs: CollapseInputs): { configurations: number; rows: Level2Row[] } {
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
        mostSensitiveKnob: mostSensitive(s)
      };
    })
    .sort((a, b) => b.baselineCP - a.baselineCP);
  return { configurations: total, rows };
}

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
function buildConfigLevels(radius: "narrow" | "medium" | "wide", n: number): LevelSet {
  const factorEnds = { narrow: [0.75, 1.333], medium: [0.5, 2], wide: [0.333, 3] }[radius];
  const priorEnds = { narrow: [0.4, 0.6], medium: [0.3, 0.7], wide: [0.2, 0.8] }[radius];
  const factors = geomSpace(factorEnds[0], factorEnds[1], n);
  const { cHalf, kHalf, uHalf } = DEFAULT_COLLAPSE_CONFIG;
  return {
    cHalf: factors.map((f) => cHalf * f),
    kHalf: factors.map((f) => kHalf * f),
    uHalf: factors.map((f) => uHalf * f),
    unknownUtilPrior: linSpace(priorEnds[0], priorEnds[1], n)
  };
}

export function computeLevel3(inputs: CollapseInputs): { designs: number; rows: Level3Row[] } {
  const designs: Array<{ radius: "narrow" | "medium" | "wide"; n: number }> = [];
  for (const radius of ["narrow", "medium", "wide"] as const) for (const n of [3, 5]) designs.push({ radius, n });

  const baseline = computeReadings(inputs);
  const perCap = new Map<string, { shares: number[]; rank1s: number[] }>();
  for (const cap of inputs.capabilities) perCap.set(cap.id, { shares: [], rank1s: [] });

  for (const design of designs) {
    const { stats, total } = sweep(inputs, buildConfigLevels(design.radius, design.n), DEFAULT_THRESHOLD_ONLY);
    for (const cap of inputs.capabilities) {
      const s = stats.get(cap.id)!;
      const p = perCap.get(cap.id)!;
      p.shares.push(s.candidate / total);
      p.rank1s.push(s.rank1 / total);
    }
  }
  const l2 = sweep(inputs, DEFAULT_CONFIG_LEVELS, DEFAULT_THRESHOLD_LEVELS);

  const rows = inputs.capabilities
    .map((cap) => {
      const p = perCap.get(cap.id)!;
      const base = baseline.find((r) => r.capability === cap.id)!;
      const min = Math.min(...p.shares);
      const max = Math.max(...p.shares);
      const spread = max - min;
      return {
        capability: cap.id,
        label: cap.label,
        baselineCP: base.collapsePotential,
        l2Share: l2.stats.get(cap.id)!.candidate / l2.total,
        min,
        max,
        mean: p.shares.reduce((a, b) => a + b, 0) / p.shares.length,
        spread,
        rank1Min: Math.min(...p.rank1s),
        classConverges: spread <= CONVERGE_SPREAD
      };
    })
    .sort((a, b) => b.baselineCP - a.baselineCP);
  return { designs: designs.length, rows };
}

/** Both levels at once, for the dashboard. */
export async function getReflection(opts: { repo: string; data: string }): Promise<{
  level2: { configurations: number; rows: Level2Row[] };
  level3: { designs: number; rows: Level3Row[] };
}> {
  const inputs = await buildInputs(opts);
  return { level2: computeLevel2(inputs), level3: computeLevel3(inputs) };
}

// ── Render (CLI) ─────────────────────────────────────────────────────────────

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function verdict2(r: Level2Row): string {
  if (r.baselineCP < 0.01 && r.candidateShare < 0.05) return "not a candidate in any configuration.";
  if (r.candidateShare <= 0.2) return "stable non-candidate — RUMI agrees it is not a latent feature.";
  const rank = r.rank1Share >= 0.8 ? "consistently RUMI's #1 pick; " : r.rank1Share >= 0.2 ? "sometimes the #1 pick; " : "";
  if (r.candidateShare >= 0.8) return `${rank}ROBUST — survives RUMI displacing its own parameters.`;
  if (r.candidateShare >= 0.5)
    return `${rank}MOSTLY ROBUST — a feature across most of RUMI's configuration space, threshold-sensitive at the margin.`;
  return `${rank}FRAGILE — reads as a feature only under part of RUMI's configuration space.`;
}

function printLevel2(data: { configurations: number; rows: Level2Row[] }, opts: ReflectOptions): void {
  const out = process.stdout;
  const top = data.rows.find((r) => r.baselineRank === 1);
  out.write("\n  RUMI - Level-2 Reflection (collapse stability under self-perturbation)\n");
  out.write(`  repo: ${path.resolve(opts.repo)}\n`);
  out.write(`  swept ${data.configurations} configurations across RUMI's own parameter manifold\n`);
  if (top) {
    out.write(
      `\n  Headline: RUMI's top selection [${top.capability}] holds rank #1 in ` +
        `${pct(top.rank1Share)} of its own plausible self-configurations.\n`
    );
  }
  out.write("\n  Discovery stability\n  -------------------\n");
  for (const r of data.rows.slice(0, opts.top ?? 10)) {
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      baseline CP        : ${r.baselineCP.toFixed(3)}  (rank #${r.baselineRank}, ${r.baselineCategory})\n`);
    out.write(`      CP across configs  : ${r.cpMin.toFixed(3)} – ${r.cpMax.toFixed(3)}\n`);
    out.write(`      stays rank #1      : ${pct(r.rank1Share)}\n`);
    out.write(`      classed a feature  : ${pct(r.candidateShare)}\n`);
    const k = r.mostSensitiveKnob;
    if (k && r.candidateShare > 0.05 && r.candidateShare < 0.95) {
      out.write(
        `      most sensitive to  : ${k.knob}  (feature ${pct(k.highShare)} at ${k.knob}=${k.highLevel} ` +
          `vs ${pct(k.lowShare)} at ${k.knob}=${k.lowLevel})\n`
      );
    }
    out.write(`      -> ${verdict2(r)}\n`);
  }
  out.write("\n");
}

function printLevel3(data: { designs: number; rows: Level3Row[] }, opts: ReflectOptions): void {
  const out = process.stdout;
  const candidates = data.rows.filter((r) => r.baselineCP >= 0.01);
  const top = data.rows[0];
  out.write("\n  RUMI - Level-3 Reflection (does the recursion converge?)\n");
  out.write(`  repo: ${path.resolve(opts.repo)}\n`);
  out.write(`  swept ${data.designs} reflection designs (perturbation radius × granularity), each a full Level-2 sweep\n`);
  if (top) {
    const rankFixed = top.rank1Min >= 0.99;
    out.write(`\n  Headline: the recursion has a SPLIT fixed point for the top discovery [${top.capability}].\n`);
    out.write(
      `  RANKING ${rankFixed ? "CONVERGES" : "does not converge"} — it is RUMI's #1 pick in ` +
        `${rankFixed ? "100%" : `≥${pct(top.rank1Min)}`} of every reflection design${rankFixed ? ", a true fixed point" : ""}.\n`
    );
    out.write(
      `  CLASSIFICATION ${top.classConverges ? "CONVERGES" : "does NOT converge"} — its 'feature' label spans ` +
        `${pct(top.min)}–${pct(top.max)} as RUMI's self-perturbation widens (Level-2 reported ${pct(top.l2Share)}).\n`
    );
    out.write(
      top.classConverges
        ? `  The meta-confidence is earned; a Level-4 sweep would add negligible information.\n`
        : `  The terminus finding: trust the RANKING; the single "${pct(top.l2Share)}" feature-stability number was itself partly an artifact of how RUMI was set to reflect. Level-3 is where that becomes visible — and where the honest recursion stops.\n`
    );
  }
  out.write("\n  Verdict stability across reflection designs\n  -------------------------------------------\n");
  for (const r of candidates.slice(0, opts.top ?? 10)) {
    out.write(`\n  > ${r.label}  [${r.capability}]\n`);
    out.write(`      Level-2 estimate     : ${pct(r.l2Share)} feature-stable\n`);
    out.write(`      across designs       : ${pct(r.min)} – ${pct(r.max)}  (mean ${pct(r.mean)}, spread ${pct(r.spread)})\n`);
    out.write(`      rank #1 (worst design): ${pct(r.rank1Min)}\n`);
    out.write(
      `      -> ${r.classConverges ? "CONVERGES — estimate stable across how RUMI reflects (the robust/fragile label is a choice of cutoff, the number is real)." : "DIVERGES — the stability estimate is itself an artifact of reflection design."}\n`
    );
  }
  if (candidates.length === 0) out.write("\n  (no candidates with non-zero Collapse Potential to reflect on)\n");
  out.write("\n");
}

export async function runReflect(opts: ReflectOptions): Promise<void> {
  const inputs = await buildInputs(opts);
  if ((opts.level ?? 2) >= 3) {
    const data = computeLevel3(inputs);
    if (opts.json) process.stdout.write(JSON.stringify({ level: 3, ...data }, null, 2) + "\n");
    else printLevel3(data, opts);
  } else {
    const data = computeLevel2(inputs);
    if (opts.json) process.stdout.write(JSON.stringify({ level: 2, ...data }, null, 2) + "\n");
    else printLevel2(data, opts);
  }
}
