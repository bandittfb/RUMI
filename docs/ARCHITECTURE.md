# RUMI — Architecture

RUMI is structured as a small pipeline: three independent **field engines** feed a **collapse engine** that produces the discovered observable, surfaced through a CLI and a local dashboard.

```
                 corrections.json ─┐
                                   ▼
   repo  ──► capacity scan ──►  ┌──────────────┐
   usage.json ──► utilization ─►│   collapse    │──► readings ──► CLI / dashboard
   corrections ──► correction ─►│   engine      │                 .rumi/last-report.json
                                └──────────────┘
```

## Modules

| Path | Role |
|------|------|
| `src/fields/correction.ts` | **C(x)** — Rectifier Seed core. Aggregates correction events into pressure (count + directional coherence), and tracks whether direction was tagged at all. |
| `src/fields/capacity.ts` | **K(x)** — walks the repo and, per file, extracts real code identifiers via a language-aware analyzer, then matches each capability's signals against them. |
| `src/fields/capacity-analyzers.ts` | Pluggable capacity analyzers + registry: a TypeScript-compiler analyzer for JS/TS, a tree-sitter analyzer for any grammar language, a comment/string-stripping text analyzer as the fallback. Adding a language = one entry. |
| `src/fields/treesitter.ts` | Lazy local loader for `web-tree-sitter` + prebuilt wasm grammars (Python, Go, Ruby, Java, Rust, PHP, C#). Grammars load only for languages the repo actually contains; no native build, no runtime network. |
| `src/fields/utilization.ts` | **U(x)** — aggregates usage telemetry and tracks which capabilities were *observed*. Absent telemetry is **unknown**, not a confident zero. |
| `src/fields/propose.ts` | **Capability auto-proposal** — clusters corrections by *distributional* similarity (co-occurrence-expanded tokens, single-linkage union-find) and derives capacity signals from recurring tokens. The divining rod's engine. |
| `src/fields/graph.ts` | Builds the repo's intra-project **file import** graph (TS compiler for JS/TS; Python relative imports; regex otherwise) — the fallback substrate for integration distance. |
| `src/fields/symbols.ts` | Builds the **symbol reference** graph for JS/TS (definition → referenced definition) — the preferred, finer substrate for integration distance. |
| `src/fields/integration.ts` | **D(x)** — integration distance: mean pairwise distance over the symbols a capability resolves to (symbol graph), falling back to its files (file graph). A *secondary* observable (ripe vs. deep), deliberately not part of CP. |
| `src/core/collapse.ts` | Scores each field on a fixed, scan-independent scale, computes `CP = C · K · (1 − U)` and a per-reading **confidence**, plus a human interpretation. |
| `src/core/normalize.ts` | Shared numeric helpers: `saturate` (scan-independent scoring), clamp, round. |
| `src/core/load.ts` | Loads `capabilities`, `corrections`, `usage` from a data dir. |
| `src/commands/*` | `scan`, `discover`, `dashboard`, `experiment` (baseline/compare). |
| `src/index.ts` | Dependency-free arg parser + command dispatch. |

## Design choices

**Capability as the coordinate.** All three fields are measured over the same index of capabilities. This is what makes the fields comparable and the intersection meaningful. Capabilities can be declared in `capabilities.json` (`scan`) or proposed by the instrument itself from correction clusters (`discover`).

**Scan-independent scoring.** Each field maps its evidence into `[0,1]` with a saturating function against a *fixed* scale (`saturate(v, half) = 1 − e^(−v/half)`), never against the per-scan maximum. A capability's `CP` therefore depends only on its own evidence — not on which other capabilities share the scan — so readings are comparable across scans, `experiment compare` is a valid before/after test, and auto-proposed capabilities don't re-rank their neighbours just by appearing.

**Confidence alongside magnitude.** Every reading carries a `confidence` (product of per-field confidences). `CP` says how strong the collapse signal is; confidence says how much to trust it. Unknown utilization, thin correction samples, or partial signal coverage lower confidence rather than silently inflating `CP`. Absent telemetry is *unknown*, never "confirmed unused".

**Multiplicative gate.** `CP` is a product, not a sum, on purpose. A latent affordance requires *all three* conditions simultaneously; an additive score would let a single loud field manufacture a false candidate.

**Two observables, kept orthogonal.** Collapse Potential answers "how strongly is this latent?"; integration distance `D(x)` answers "how far apart are the pieces?". They are independent axes — a strongly-wanted feature can be nearly assembled or scattered — so `D` is reported alongside `CP`, never folded into it. Together they sort candidates into *ripe* (high CP, low D — build now) and *deep* (high CP, high D — real composition work), prioritization a raw backlog cannot give. `D` is measured on the symbol reference graph where possible (do these definitions actually reference each other?), not merely the file graph (do their files import each other?) — so pieces sharing a file but nothing else read as deep, not falsely co-located.

**Local-first.** The instrument runs entirely on the user's machine — source code, correction logs, and usage traces never leave it. This is a trust requirement, not just a convenience. The one runtime dependency is the local `typescript` compiler, used to parse JS/TS for capacity; it performs no network access.

## Roadmap

Capacity and proposal are deliberately seams. Status and planned depth, roughly in order:

1. **Code-aware capacity** — *done for JS/TS*: real identifier extraction via the TypeScript compiler, with a comment/string/keyword-aware text analyzer as the fallback for other languages (`capacity-analyzers.ts`). Import-graph analysis and *integration distance* are *done* (`graph.ts`, `integration.ts`), as is *multi-language capacity* via tree-sitter (`treesitter.ts`: Python, Go, Ruby, Java, Rust, PHP, C#). Integration distance uses a JS/TS symbol reference graph (with the file import graph — JS/TS + Python — as fallback). Next: symbol graphs for more languages via tree-sitter; declaration-vs-use weighting; import resolution for Go/Java/Rust.
2. **Correction-capture SDK** — a normalized correction schema with a redaction layer, so `corrections.json` is produced from real `before → after` events (incl. agent-session exports) rather than hand-authored.
3. **Candidate auto-proposal** — *working* (`discover`, `propose.ts`): distributional (co-occurrence) clustering of corrections into proposed capabilities, so corrections about the same thing group even with no shared words. Next depth: an opt-in pretrained-embedding backend for outside-world synonymy (local inference, one model download), and joining proposals to the code graph.
4. **IDE / workbench panel** — surface candidates linked to actual files inside VS Code or a Codex-style workspace ("architectural microscope").
5. **Sidecar mode** — optional self-hosted collector for team telemetry, CI gate on Collapse Potential regressions.
6. **Level-2 / Level-3 analysis** — treat RUMI's own discovery as a computation with its own displacement field (recursive manifold analysis), per the Displacement Code Challenge's final frontier.

## The discovered observable

For the Displacement Code Challenge, the candidate discovery is **Collapse Potential**: a measurable scalar at the intersection of correction, capacity, and utilization that is independent of any single conventional metric and predicts where a system is already trying to become something it has not yet realized.

> *Of course. Users were already showing us the hidden objective through their corrections. How did we never measure that?*
