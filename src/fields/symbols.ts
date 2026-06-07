/**
 * Symbol reference graph — the fine-grained substrate for integration distance.
 *
 * The file import graph (graph.ts) asks "do these files import each other?".
 * That is coarse: two functions can sit in the same file yet never touch, or
 * live in files that import each other for unrelated reasons. The symbol graph
 * asks the sharper question — "do these specific definitions actually reference
 * each other?" — by linking a defined symbol to every other defined symbol whose
 * name appears in its definition (a call, a type use, an inheritance, etc.).
 *
 * Built for JS/TS via the TypeScript compiler (precise declarations + bodies).
 * Integration distance uses it when a capability's signals resolve to ≥2 defined
 * symbols, and falls back to the file graph otherwise (other languages, or
 * signals that map only to uses rather than declarations).
 *
 * Nodes are keyed by lowercased symbol name — the same space capability signals
 * match against — so same-named symbols across files are treated as one concept.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { listCodeFiles } from "./capacity.js";
import { tokensForIdentifier, type CodeTokens } from "./capacity-analyzers.js";

export interface SymbolGraph {
  /** Undirected adjacency between defined symbol names (lowercased). */
  adjacency: Map<string, Set<string>>;
  /** Match tokens per defined symbol name, for resolving signals → symbols. */
  nameTokens: Map<string, CodeTokens>;
}

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

function declaredName(node: ts.Node): string | undefined {
  if (
    ts.isFunctionDeclaration(node) ||
    ts.isClassDeclaration(node) ||
    ts.isInterfaceDeclaration(node) ||
    ts.isTypeAliasDeclaration(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isMethodDeclaration(node)
  ) {
    return node.name && ts.isIdentifier(node.name) ? node.name.text : undefined;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return undefined;
}

export async function buildSymbolGraph(repoRoot: string): Promise<SymbolGraph> {
  const files = (await listCodeFiles(repoRoot)).filter((f) =>
    TS_EXTENSIONS.has(path.extname(f))
  );

  // First pass: collect every defined symbol and the identifiers it references.
  const refsByName = new Map<string, Set<string>>(); // lower name -> referenced names (lower)
  const nameTokens = new Map<string, CodeTokens>();

  for (const file of files) {
    let source: ts.SourceFile;
    try {
      source = ts.createSourceFile(
        file,
        await fs.readFile(file, "utf8"),
        ts.ScriptTarget.Latest,
        true
      );
    } catch {
      continue;
    }

    const visit = (node: ts.Node): void => {
      const name = declaredName(node);
      if (name) {
        const key = name.toLowerCase();
        if (!nameTokens.has(key)) nameTokens.set(key, tokensForIdentifier(name));
        const refs = refsByName.get(key) ?? refsByName.set(key, new Set()).get(key)!;
        // Every identifier inside this declaration is a potential reference.
        const collect = (n: ts.Node): void => {
          if (ts.isIdentifier(n)) refs.add(n.text.toLowerCase());
          ts.forEachChild(n, collect);
        };
        collect(node);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }

  // Second pass: keep only edges between two DEFINED symbols (drop external refs
  // and self-references), undirected.
  const defined = new Set(nameTokens.keys());
  const adjacency = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string): void => {
    if (a === b) return;
    (adjacency.get(a) ?? adjacency.set(a, new Set()).get(a)!).add(b);
    (adjacency.get(b) ?? adjacency.set(b, new Set()).get(b)!).add(a);
  };
  for (const [name, refs] of refsByName) {
    for (const ref of refs) if (defined.has(ref)) addEdge(name, ref);
  }

  return { adjacency, nameTokens };
}
