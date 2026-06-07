/**
 * `rumi dashboard` — local-first web observatory.
 *
 * Computes all three views live against the configured repo/data and serves them
 * on localhost. No upload, no external service: the instrument runs where the
 * code lives. Scan (Level-1), Discover (emergent), and Reflect (Level-2/3) each
 * have a JSON endpoint the page fetches.
 */
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runScan } from "./scan.js";
import { runDiscover } from "./discover.js";
import { getReflection } from "./reflect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface DashboardOptions {
  port: number;
  repo: string;
  data: string;
}

export async function runDashboard(opts: DashboardOptions): Promise<void> {
  const htmlPath = path.join(__dirname, "..", "..", "public", "dashboard.html");
  const ctx = { repo: opts.repo, data: opts.data };

  const json = (res: http.ServerResponse, body: unknown, code = 200): void => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url === "/api/scan") return json(res, await runScan({ ...ctx, quiet: true }));
      if (req.url === "/api/discover") return json(res, await runDiscover({ ...ctx, quiet: true }));
      if (req.url === "/api/reflect") return json(res, await getReflection(ctx));
      const html = await fs.readFile(htmlPath, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch (err) {
      json(res, { error: err instanceof Error ? err.message : String(err) }, 500);
    }
  });

  server.listen(opts.port, () => {
    process.stdout.write(`\n  RUMI observatory → http://localhost:${opts.port}\n`);
    process.stdout.write(`  repo: ${path.resolve(opts.repo)}   (Ctrl+C to stop)\n\n`);
  });
}
