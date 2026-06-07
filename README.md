# RUMI

**Revealed Uncollapsed Manifold Instrument**

A local-first instrument for discovering *latent affordances* — features your codebase already almost contains, that your users are already trying to collapse into existence.

RUMI does not tell you what happened. It lets you see something you could not previously perceive: the gap between what a system selected, what humans keep correcting it toward, what the code can already support, and what is actually being used.

> Registered as **DCC-2026-001** in the Displacement Code Challenge.
> RUMI is the instrument. **Rectifier Seed** is the correction-field core inside it.

## The idea

Every system selection displaces alternatives. Some of those displaced alternatives become visible when users correct, override, rephrase, retry, or repair the system. RUMI reads three fields over a shared index of *capabilities*:

| Field | Symbol | Question |
|------|--------|----------|
| Correction | `C(x)` | What do humans keep pushing the system toward? |
| Capacity | `K(x)` | What does the codebase structurally already support? |
| Utilization | `U(x)` | What is actually being used? |

The interesting region is **high C, high K, low U** — strong correction pressure meeting latent, unused capacity. RUMI quantifies that region as a single discovered observable:

```
Collapse Potential   CP(x) = C(x) · K(x) · (1 − U(x))
```

`CP` is high only when all three conditions hold at once. It is not a simple function of any single existing metric:

- high corrections alone → may be an *unsupported wish*
- high capacity alone → may be *dormant code* nobody wants
- low usage alone → nobody wants it either

The product gates the discovery on the intersection. That intersection is where an **uncollapsed feature** lives.

## Quick start

```bash
npm install
npm run build

# scan the bundled example (the "enterprise renewal risk" demo)
npm run scan
# or directly:
node dist/index.js scan --repo <path-to-repo> --data <path-to-data-dir>

# explore the candidates in the browser
npm run dashboard        # http://localhost:4317
```

### What the example shows

Running against `examples/sample-repo` surfaces, as the top candidate:

```
▸ Enterprise Renewal Risk Review  [enterprise-renewal-risk]
    Collapse Potential : 0.667
    confidence         : 0.811
    C  correction      : 0.811  (5 events, coherence 1)
    K  capacity        : 0.865  (6 signals, 4 files)
    U  utilization     : 0.049  (1 uses)
    D  integration    : 1.000  DEEP — pieces scattered with no shared dependency path
    → Uncollapsed feature: strong correction pressure meets latent capacity that is barely used.
```

Each field is scored on a **fixed, scan-independent scale** — a capability's `CP`
depends only on its own evidence, never on which other capabilities share the
scan — so readings are comparable across scans and `experiment compare` is a
real before/after test. Every reading also carries a **confidence** in `[0,1]`:
`CP` says how strong the collapse signal is; confidence says how much to trust
that number. A high `CP` with low confidence (e.g. correction pressure but
*unknown* utilization) is a lead to verify, not a conclusion to act on — absent
telemetry is treated as unknown, never as "confirmed unused".

The pieces (`segmentation`, `renewalDate`, `riskScore`, `reportBuilder`, `ownerRouting`, `blockers`) all already exist in the repo, scattered across four files. No workflow composes them. Users keep correcting generic reports toward renewal-risk reviews. RUMI names the gap.

Contrast with the other capabilities the same scan classifies:

- **Bulk Data Export** → *unsupported wish* (users want it, no code supports it)
- **Dark Mode** → *already collapsed* (realized and in active use)

## Commands

```
rumi scan       --repo <dir> --data <dir> [--json] [--top N]
rumi discover   --repo <dir> --data <dir> [--json] [--top N]
rumi dashboard  [--port 4317]
rumi experiment baseline --repo <dir> --data <dir>
rumi experiment compare  --repo <dir> --data <dir>
```

`experiment baseline` snapshots the field; after you ship a change, `experiment compare` checks whether correction pressure actually decayed and utilization rose — i.e. whether the latent affordance **collapsed** into a real, used workflow. The instrument verifies collapse; it does not stop at discovery.

## Integration distance: ripe vs. deep

Collapse Potential tells you a latent feature is *wanted and possible*. It does
not tell you how much work it is. **Integration distance** `D(x)` is a second,
independent observable: given the files where a capability's pieces were found,
it measures how far apart they are in the repo's import graph.

```
Collapse Potential   → how strongly the system wants this   (is it latent?)
Integration distance → how far apart the pieces are         (how hard to build?)
```

These are orthogonal, so they sort candidates into actionable quadrants:

- **high CP, low D → RIPE.** Strongly wanted, pieces already connected. A quick wire-up — build it now.
- **high CP, high D → DEEP.** Strongly wanted, but pieces scattered with no shared dependency path. Real composition work.

On the example, the strongest candidate by `CP` is *deep*, while a slightly weaker one is *ripe* — exactly the prioritization a backlog can't give you:

```
▸ Enterprise Renewal Risk Review   CP 0.667   D 1.000  DEEP  (4 unconnected files)
▸ Weekly Digest                    CP 0.421   D 0.333  RIPE  (2 files, already importing)
```

`D` is computed from the same code graph as capacity (TypeScript imports parsed
directly; relative imports in other languages by best-effort), and like every
RUMI field it is scan-independent.

## The divining rod: `discover`

`scan` measures Collapse Potential over capabilities *you declared*. `discover` removes that scaffolding — it is handed **no `capabilities.json`** and proposes the capabilities itself, purely from the correction field. It clusters corrections by what users keep pushing toward, derives each cluster's capacity signals from the tokens that recur across it, scans the repo for them, and runs the ordinary collapse engine. A dense, coherent knot of corrections that *no one named* is exactly where an emergent feature first becomes visible — before there is a word for it.

```bash
npm run discover
```

On the bundled example, given 10 raw corrections and zero declared capabilities, RUMI's top emergent proposal is:

```
▸ Renewal / Risk / Blocker (×5)  [emergent-renewal-risk-blocker]
    proposed signals   : renewal, risk, blocker, owner, report
    Collapse Potential : 0.315
    confidence         : 0.162   ⚠ usage unverified
    capacity in        : risk-score.ts, report-builder.ts, owner-routing.ts
    → Candidate uncollapsed feature — BUT utilization is unknown: confirm it isn't already in use before acting.
```

It reconstructs the renewal-risk capability on its own and points at the real files — with **no capability declared**. Because an auto-proposed capability has no usage record, its utilization is *unknown by construction*, so every emergent candidate arrives flagged as a lead to verify, never a conclusion. This is the line between divining rod and horoscope: the proposal is only confirmed if naming and building it makes the correction pressure actually decay (`experiment compare`).

The clustering is deliberately local and zero-dependency (corrections never leave the machine); lexical overlap is the floor, with local embeddings / a code-graph join as the planned depth.

## Inputs

RUMI reads a data directory containing:

- `capabilities.json` — the coordinates: each capability's id, label, and the code `signals` that indicate capacity for it. Required for `scan`; **`discover` does not use it** (it proposes capabilities itself).
- `corrections.json` — correction events (`before` → `after`) tagged by capability and direction.
- `usage.json` — optional telemetry: how much each capability is actually exercised.

Plus a target repo, scanned locally for capacity signals. **Nothing is uploaded.** The instrument runs where the code lives.

## Status

`0.5.0` — working instrument: three-field engine, scan-independent Collapse Potential with per-reading **confidence** (unknown utilization is never mistaken for confirmed-unused), **code-aware capacity across many languages** (JS/TS via the TypeScript compiler; Python, Go, Ruby, Java, Rust, PHP, C# via tree-sitter; a comment/string/keyword-aware text analyzer as the fallback — a signal in a comment never counts as code), **integration distance** (a second observable ranking candidates ripe vs. deep from the repo's import graph; JS/TS and Python imports resolved), CLI, local dashboard, baseline/compare, and **emergent capability discovery** (`discover`) — the instrument can propose undeclared capabilities from the correction field alone.

All parsing is local: tree-sitter runs on prebuilt wasm grammars shipped on disk — nothing touches the network at run time.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design and roadmap. Next depth: meaning-based clustering for `discover`, import resolution for more languages, correction-capture SDK, VS Code panel, recursive / Level-3 analysis.
