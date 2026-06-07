/**
 * `rumi dashboard` — local-first web view of the latest scan.
 *
 * Serves the last report from .rumi/last-report.json on localhost. No upload,
 * no external service: the instrument runs where the code lives.
 */
import { promises as fs } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RUMI_DIR = ".rumi";
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function runDashboard(opts: { port: number }): Promise<void> {
  const reportPath = path.join(RUMI_DIR, "last-report.json");
  const htmlPath = path.join(__dirname, "..", "..", "public", "dashboard.html");

  const server = http.createServer(async (req, res) => {
    if (req.url === "/api/report") {
      try {
        const data = await fs.readFile(reportPath, "utf8");
        res.writeHead(200, { "content-type": "application/json" });
        res.end(data);
      } catch {
        res.writeHead(404, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "No report yet. Run `rumi scan` first." }));
      }
      return;
    }
    try {
      const html = await fs.readFile(htmlPath, "utf8");
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
    } catch {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("dashboard.html not found");
    }
  });

  server.listen(opts.port, () => {
    process.stdout.write(`\n  RUMI dashboard → http://localhost:${opts.port}\n`);
    process.stdout.write("  Reading .rumi/last-report.json   (Ctrl+C to stop)\n\n");
  });
}
