/**
 * `rumi map` — code-only capability discovery.
 *
 * Unlike `scan`/`discover`, this needs NO data dir at all: no declared
 * capabilities, no corrections. It reads a codebase and surfaces what abilities
 * the code already contains and how they compose — the supply side of RUMI on
 * its own. It cannot tell you what's *wanted* (that needs the correction field);
 * it tells you what's *there*: the foundations everything leans on, the surfaces
 * users touch, where the abilities concentrate, and what sits unwired.
 *
 * A module (file) is treated as a capability; its defined functions/classes are
 * its abilities; the import graph is how they compose.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { listCodeFiles } from "../fields/capacity.js";
import { treeSitterLangForExt, makeParser } from "../fields/treesitter.js";

export interface MapOptions {
  repo: string;
  json?: boolean;
  top?: number;
}

const DEF_TYPES: Record<string, Set<string>> = {
  python: new Set(["function_definition", "class_definition"]),
  ruby: new Set(["method", "class", "module"]),
  go: new Set(["function_declaration", "method_declaration", "type_declaration"]),
  java: new Set(["method_declaration", "class_declaration", "interface_declaration"]),
  rust: new Set(["function_item", "struct_item", "enum_item", "trait_item"]),
  php: new Set(["function_definition", "class_declaration", "method_declaration"]),
  c_sharp: new Set(["method_declaration", "class_declaration", "interface_declaration"])
};

interface Module {
  rel: string;
  moduleName: string;
  defs: string[];
  imports: Set<string>; // resolved rel paths of imported modules
  inDegree: number;
}

function toModuleName(rel: string): string {
  const noExt = rel.replace(/\.[^.]+$/, "");
  const dotted = noExt.split(/[\\/]/).join(".");
  return dotted.replace(/\.__init__$/, "");
}

/** Extract defined function/class names via tree-sitter (best-effort). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractDefs(parser: any, text: string, defTypes: Set<string>): string[] {
  const defs: string[] = [];
  let tree: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    tree = parser.parse(text);
  } catch {
    return defs;
  }
  const stack = [tree.rootNode];
  while (stack.length) {
    const node = stack.pop();
    if (!node) continue;
    if (defTypes.has(node.type)) {
      const name = node.childForFieldName?.("name");
      if (name?.text) defs.push(name.text);
    }
    for (let i = 0; i < node.childCount; i++) stack.push(node.child(i));
  }
  tree.delete?.();
  return defs;
}

/** Python-style import module specifiers (absolute + relative). */
function pythonImportSpecs(text: string): string[] {
  const specs: string[] = [];
  for (const m of text.matchAll(/^[ \t]*from[ \t]+([.\w]+)[ \t]+import\b/gm)) specs.push(m[1]);
  for (const m of text.matchAll(/^[ \t]*import[ \t]+([.\w]+)/gm)) specs.push(m[1]);
  return specs;
}

function resolveSpec(spec: string, importerModule: string, index: Map<string, string>): string | null {
  let target = spec;
  if (spec.startsWith(".")) {
    const dots = spec.match(/^\.+/)![0].length;
    const rest = spec.slice(dots);
    const pkg = importerModule.split(".").slice(0, -1); // package of importer
    const base = pkg.slice(0, pkg.length - (dots - 1));
    target = [...base, ...(rest ? rest.split(".") : [])].join(".");
  }
  if (index.has(target)) return index.get(target)!;
  // `from pkg.mod import name` where name is itself a submodule
  const parent = target.split(".").slice(0, -1).join(".");
  if (parent && index.has(parent)) return index.get(parent)!;
  return null;
}

function isTestFile(rel: string): boolean {
  const base = rel.split(/[\\/]/).pop() ?? "";
  return /(^|[\\/])tests?[\\/]/.test(rel) || /^test_/.test(base) || /_test\.\w+$/.test(base) || /^conftest\./.test(base);
}

export async function runMap(opts: MapOptions): Promise<void> {
  const allFiles = (await listCodeFiles(opts.repo)).map((f) => path.relative(opts.repo, f));
  // Tests verify capabilities, they are not capabilities — set them aside so they
  // don't masquerade as surfaces or inflate dependency counts.
  const testCount = allFiles.filter(isTestFile).length;
  const files = allFiles.filter((f) => !isTestFile(f));
  const index = new Map<string, string>();
  for (const rel of files) index.set(toModuleName(rel), rel);

  const parsers = new Map<string, any>(); // eslint-disable-line @typescript-eslint/no-explicit-any
  const getParser = async (lang: string) => {
    if (!parsers.has(lang)) parsers.set(lang, await makeParser(lang));
    return parsers.get(lang);
  };

  const modules = new Map<string, Module>();
  for (const rel of files) {
    const lang = treeSitterLangForExt(path.extname(rel));
    let text = "";
    try {
      text = await fs.readFile(path.join(opts.repo, rel), "utf8");
    } catch {
      continue;
    }
    const moduleName = toModuleName(rel);
    let defs: string[] = [];
    if (lang && DEF_TYPES[lang]) {
      const parser = await getParser(lang);
      if (parser) defs = extractDefs(parser, text, DEF_TYPES[lang]);
    }
    const imports = new Set<string>();
    for (const spec of pythonImportSpecs(text)) {
      const t = resolveSpec(spec, moduleName, index);
      if (t && t !== rel) imports.add(t);
    }
    modules.set(rel, { rel, moduleName, defs, imports, inDegree: 0 });
  }

  // In-degree: how many modules import each module.
  for (const m of modules.values()) for (const dep of m.imports) {
    const target = modules.get(dep);
    if (target) target.inDegree++;
  }

  const all = [...modules.values()];
  const internal = all.filter((m) => m.defs.length > 0 || m.imports.size > 0 || m.inDegree > 0);
  const totalEdges = all.reduce((n, m) => n + m.imports.size, 0);
  const totalDefs = all.reduce((n, m) => n + m.defs.length, 0);

  const byIn = [...internal].sort((a, b) => b.inDegree - a.inDegree || b.defs.length - a.defs.length);
  const byDefs = [...internal].sort((a, b) => b.defs.length - a.defs.length);
  const foundations = byIn.filter((m) => m.inDegree >= 2).slice(0, opts.top ?? 8);
  const surfaces = internal
    .filter((m) => m.inDegree === 0 && m.imports.size >= 2 && m.defs.length > 0)
    .sort((a, b) => b.imports.size - a.imports.size);
  const richLowReuse = byDefs
    .filter((m) => m.defs.length >= 5 && m.inDegree <= 1 && m.imports.size <= 1)
    .slice(0, opts.top ?? 8);
  const isolated = internal.filter((m) => m.inDegree === 0 && m.imports.size === 0 && m.defs.length > 0);

  if (opts.json) {
    process.stdout.write(JSON.stringify({
      repo: path.resolve(opts.repo),
      moduleCount: internal.length, totalEdges, totalDefs,
      modules: internal.map((m) => ({ module: m.moduleName, file: m.rel, defs: m.defs.length, inDegree: m.inDegree, outDegree: m.imports.size }))
    }, null, 2) + "\n");
    return;
  }

  const out = process.stdout;
  const list = (m: Module) => `${m.moduleName}  (${m.defs.length} defs, used by ${m.inDegree})`;
  out.write("\n  RUMI - Capability Map (code-only — no corrections, no declared capabilities)\n");
  out.write(`  repo: ${path.resolve(opts.repo)}\n`);
  out.write(`  ${internal.length} capability modules · ${totalDefs} defined abilities · ${totalEdges} internal links  (${testCount} test modules set aside)\n`);
  out.write("\n  NOTE: this is the SUPPLY side only — what the code can do, not what users want.\n");
  out.write("  Connect a correction stream (rumi scan/discover) to learn which of these to surface.\n");

  out.write("\n  Foundations — most depended-on (the shared vocabulary)\n  ----------------------------------------------------\n");
  for (const m of foundations) out.write(`    ${list(m)}\n`);

  out.write("\n  Surfaces — entry points nothing imports (the features users touch)\n  -----------------------------------------------------------------\n");
  for (const m of surfaces.slice(0, opts.top ?? 8)) out.write(`    ${m.moduleName}  (composes ${m.imports.size} modules, ${m.defs.length} defs)\n`);

  out.write("\n  Concentrated abilities — most-defined modules\n  ---------------------------------------------\n");
  for (const m of byDefs.slice(0, opts.top ?? 8)) {
    const sample = m.defs.slice(0, 6).join(", ");
    out.write(`    ${m.moduleName}  (${m.defs.length})  ${sample}${m.defs.length > 6 ? ", …" : ""}\n`);
  }

  if (richLowReuse.length) {
    out.write("\n  Rich but lightly composed — capability that exists but is barely reused\n  ----------------------------------------------------------------------\n");
    for (const m of richLowReuse) out.write(`    ${list(m)}  → candidate to surface, or dead weight\n`);
  }
  if (isolated.length) {
    out.write("\n  Isolated — no internal links either way (standalone, or unwired)\n  ---------------------------------------------------------------\n");
    for (const m of isolated.slice(0, opts.top ?? 12)) out.write(`    ${list(m)}\n`);
  }
  out.write("\n");
}
