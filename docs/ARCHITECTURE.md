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
| `src/fields/correction.ts` | **C(x)** — Rectifier Seed core. Aggregates correction events into pressure, weighting recurrence (`log1p` of count) by directional coherence. |
| `src/fields/capacity.ts` | **K(x)** — lightweight static scan of the target repo for each capability's declared signals. Rewards breadth (distinct signals) × spread (`log1p` of files). |
| `src/fields/utilization.ts` | **U(x)** — aggregates optional usage telemetry. Missing usage = 0 (a stronger collapse candidate), not "unknown". |
| `src/core/collapse.ts` | Normalizes the three fields to `[0,1]` and computes `CP = C · K · (1 − U)`, plus a human interpretation per reading. |
| `src/core/normalize.ts` | Shared numeric helpers (max-normalization, clamp, round). |
| `src/core/load.ts` | Loads `capabilities`, `corrections`, `usage` from a data dir. |
| `src/commands/*` | `scan`, `dashboard`, `experiment` (baseline/compare). |
| `src/index.ts` | Zero-dependency arg parser + command dispatch. |

## Design choices

**Capability as the coordinate.** All three fields are measured over the same index of capabilities. This is what makes the fields comparable and the intersection meaningful. Capabilities are declared in `capabilities.json` today; a future analyzer can propose them automatically from correction clusters.

**Max-normalization per scan.** Each field is normalized against its own maximum within a single scan, keeping `C`, `K`, `U` on a shared `[0,1]` scale so `CP` is interpretable as "relative to the strongest signal seen here." Cross-scan comparison is handled separately by `experiment compare` against a stored baseline.

**Multiplicative gate.** `CP` is a product, not a sum, on purpose. A latent affordance requires *all three* conditions simultaneously; an additive score would let a single loud field manufacture a false candidate.

**Local-first, zero runtime deps.** The only dependencies are dev-time (`typescript`, `@types/node`). The instrument runs entirely on the user's machine — source code, correction logs, and usage traces never leave it. This is a trust requirement, not just a convenience.

## Roadmap

The current capacity scan is deliberately a seam. Planned depth, roughly in order:

1. **AST / code-graph capacity** — replace keyword presence with symbol- and import-graph analysis, and estimate *integration distance* (how far apart the pieces are) as a secondary observable.
2. **Correction-capture SDK** — a normalized correction schema with a redaction layer, so `corrections.json` is produced from real `before → after` events (incl. agent-session exports) rather than hand-authored.
3. **Candidate auto-proposal** — cluster correction vectors to propose capabilities instead of requiring them to be declared.
4. **IDE / workbench panel** — surface candidates linked to actual files inside VS Code or a Codex-style workspace ("architectural microscope").
5. **Sidecar mode** — optional self-hosted collector for team telemetry, CI gate on Collapse Potential regressions.
6. **Level-2 / Level-3 analysis** — treat RUMI's own discovery as a computation with its own displacement field (recursive manifold analysis), per the Displacement Code Challenge's final frontier.

## The discovered observable

For the Displacement Code Challenge, the candidate discovery is **Collapse Potential**: a measurable scalar at the intersection of correction, capacity, and utilization that is independent of any single conventional metric and predicts where a system is already trying to become something it has not yet realized.

> *Of course. Users were already showing us the hidden objective through their corrections. How did we never measure that?*
