#!/usr/bin/env node
/**
 * RUMI — Revealed Uncollapsed Manifold Instrument.
 *
 * A local-first instrument for discovering latent affordances at the
 * intersection of correction pressure (C), code capacity (K), and
 * utilization (U). Built on the Rectifier Seed correction-field core.
 *
 * Commands:
 *   rumi scan --repo <dir> --data <dir> [--json] [--top N]
 *   rumi dashboard [--port N]
 *   rumi experiment baseline --repo <dir> --data <dir>
 *   rumi experiment compare  --repo <dir> --data <dir>
 */
import { runScan } from "./commands/scan.js";
import { runDiscover } from "./commands/discover.js";
import { runReflect } from "./commands/reflect.js";
import { runMap } from "./commands/map.js";
import { runDashboard } from "./commands/dashboard.js";
import { runBaseline, runCompare } from "./commands/experiment.js";

interface Flags {
  _: string[];
  [k: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      (flags._ as string[]).push(a);
    }
  }
  return flags;
}

const HELP = `
RUMI — Revealed Uncollapsed Manifold Instrument

Usage:
  rumi scan       --repo <dir> --data <dir> [--json] [--top N]
  rumi discover   --repo <dir> --data <dir> [--json] [--top N]
  rumi map        --repo <dir> [--json] [--top N]   (code-only, no data needed)
  rumi reflect    --repo <dir> --data <dir> [--json] [--top N] [--level 2|3]
  rumi dashboard  [--port 4317]
  rumi experiment baseline --repo <dir> --data <dir>
  rumi experiment compare  --repo <dir> --data <dir>

Fields:
  C(x) correction   what humans keep pushing the system toward
  K(x) capacity     what the codebase structurally can support
  U(x) utilization  what is actually being used

Discovery:
  Collapse Potential = C * K * (1 - U)
  High C, high K, low U => an uncollapsed feature the system is trying to become.
`;

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const [cmd, sub] = flags._ as string[];
  const repo = (flags.repo as string) ?? "examples/sample-repo";
  const data = (flags.data as string) ?? "examples/data";

  switch (cmd) {
    case "scan":
      await runScan({
        repo,
        data,
        json: Boolean(flags.json),
        top: flags.top ? Number(flags.top) : 10
      });
      break;
    case "discover":
      await runDiscover({
        repo,
        data,
        json: Boolean(flags.json),
        top: flags.top ? Number(flags.top) : 10
      });
      break;
    case "map":
      await runMap({ repo, json: Boolean(flags.json), top: flags.top ? Number(flags.top) : 8 });
      break;
    case "reflect":
      await runReflect({
        repo,
        data,
        json: Boolean(flags.json),
        top: flags.top ? Number(flags.top) : 10,
        level: flags.level ? Number(flags.level) : 2
      });
      break;
    case "dashboard":
      await runDashboard({ port: flags.port ? Number(flags.port) : 4317, repo, data });
      break;
    case "experiment":
      if (sub === "baseline") await runBaseline({ repo, data });
      else if (sub === "compare") await runCompare({ repo, data });
      else process.stdout.write("Unknown experiment subcommand. Use `baseline` or `compare`.\n");
      break;
    case "help":
    case undefined:
      process.stdout.write(HELP);
      break;
    default:
      process.stderr.write(`Unknown command: ${cmd}\n${HELP}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  process.stderr.write(`\n  RUMI error: ${err instanceof Error ? err.message : String(err)}\n\n`);
  process.exitCode = 1;
});
