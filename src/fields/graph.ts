/**
 * Repo import graph — the substrate for integration distance.
 *
 * Capacity tells us a capability's pieces EXIST; it doesn't tell us how far
 * apart they are. Two functions that already import each other are nearly a
 * feature; two that live in unconnected corners of the codebase need real glue.
 * To measure that we build the repo's intra-project import graph: an undirected
 * edge between two files when one imports the other (relative imports only —
 * external packages are irrelevant to whether the repo's own pieces connect).
 *
 * JS/TS imports are parsed with the TypeScript compiler (import / export-from /
 * require / dynamic import). Other languages fall back to a relative-path regex.
 * Specifiers are resolved to real files (NodeNext `.js` → `.ts`, index files),
 * and the graph is keyed by repo-relative paths so it lines up with the files
 * reported in CapacityEvidence.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { listCodeFiles } from "./capacity.js";

/** Undirected adjacency, keyed by repo-relative file path. */
export type ImportGraph = Map<string, Set<string>>;

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const RESOLVE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"];

/** Normalize an absolute path for case-insensitive, separator-agnostic lookup. */
function norm(p: string): string {
  return path.resolve(p).replace(/\\/g, "/").toLowerCase();
}

export async function buildImportGraph(repoRoot: string): Promise<ImportGraph> {
  const files = await listCodeFiles(repoRoot);
  const absToRel = new Map<string, string>();
  for (const f of files) absToRel.set(norm(f), path.relative(repoRoot, f));

  const graph: ImportGraph = new Map();
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    (graph.get(a) ?? graph.set(a, new Set()).get(a)!).add(b);
    (graph.get(b) ?? graph.set(b, new Set()).get(b)!).add(a);
  };

  for (const file of files) {
    let text: string;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const importerRel = path.relative(repoRoot, file);
    const specs = TS_EXTENSIONS.has(path.extname(file))
      ? tsImportSpecifiers(file, text)
      : regexImportSpecifiers(text);

    for (const spec of specs) {
      const targetAbs = resolveSpecifier(file, spec, absToRel);
      if (!targetAbs) continue;
      const targetRel = absToRel.get(targetAbs);
      if (targetRel) addEdge(importerRel, targetRel);
    }
  }
  return graph;
}

function tsImportSpecifiers(fileName: string, text: string): string[] {
  const specs: string[] = [];
  let source: ts.SourceFile;
  try {
    source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  } catch {
    return regexImportSpecifiers(text);
  }
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (ts.isCallExpression(node)) {
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      const isDynImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const arg = node.arguments[0];
      if ((isRequire || isDynImport) && arg && ts.isStringLiteral(arg)) {
        specs.push(arg.text);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return specs;
}

/** Best-effort relative-import extraction for non-JS/TS languages. */
function regexImportSpecifiers(text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(/(?:from|import|require)\s*\(?\s*["'](\.[^"']*)["']/g)) {
    specs.push(m[1]);
  }
  return specs;
}

function resolveSpecifier(
  importerAbs: string,
  spec: string,
  absToRel: Map<string, string>
): string | null {
  if (!spec.startsWith(".")) return null; // external package — not an intra-repo edge
  const base = path.resolve(path.dirname(importerAbs), spec);

  const candidates: string[] = [base];
  // NodeNext: a ".js" specifier often points at a ".ts" source.
  const ext = path.extname(base);
  const stem = ext ? base.slice(0, -ext.length) : base;
  for (const e of RESOLVE_EXTENSIONS) {
    candidates.push(stem + e);
    candidates.push(base + e);
    candidates.push(path.join(base, "index" + e));
  }

  for (const c of candidates) {
    const key = norm(c);
    if (absToRel.has(key)) return key;
  }
  return null;
}
