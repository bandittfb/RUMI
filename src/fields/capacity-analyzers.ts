/**
 * Capacity analyzers — pluggable, language-aware "what does this file actually
 * contain as code" extractors.
 *
 * A capability's capacity should reflect real code, not prose. A plain text
 * search can't tell a working `riskScore` function from the word "risk" in a
 * comment, or from the language keyword `export` that appears in every file.
 * This module replaces that with a small registry of analyzers:
 *
 *   - textAnalyzer        (Rung A) strips comments + string literals, ignores
 *                         language keywords, and matches real identifier tokens.
 *                         The fallback for ANY language we don't yet parse.
 *   - typeScriptAnalyzer  (Rung B) parses JS/TS with the TypeScript compiler and
 *                         collects genuine code identifiers — the parser knows a
 *                         keyword from an identifier, so `export`/`function`/etc.
 *                         can never be mistaken for capacity.
 *
 * Adding a language later (Rung C) means writing one analyzer and registering it
 * in `analyzerForExtension` — nothing else changes.
 *
 * Each analyzer returns `CodeTokens`: the lowercased full identifiers present in
 * real code, plus their singularized word-parts (so the natural-language signals
 * RUMI auto-derives — "renewal", "owner" — match camelCase symbols like
 * `renewalDate`, `ownerRouting`).
 */
import ts from "typescript";

export interface CodeTokens {
  /** Lowercased whole identifiers found in real code (e.g. "riskscore"). */
  full: Set<string>;
  /** Singularized word-parts of those identifiers (e.g. "risk", "score"). */
  parts: Set<string>;
}

export interface CapacityAnalyzer {
  readonly name: string;
  analyze(text: string, fileName: string): CodeTokens;
}

/** Split an identifier into lowercase word-parts (camelCase, snake/kebab, digits). */
export function splitIdentifier(id: string): string[] {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .map((s) => s.toLowerCase())
    .filter(Boolean);
}

/** Light singularization so "blocker" matches the identifier `blockers`. */
export function singularize(t: string): string {
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

function addIdentifier(tok: CodeTokens, id: string): void {
  if (!id) return;
  const parts = splitIdentifier(id).map(singularize);
  if (parts.length === 0) return;
  tok.full.add(id.toLowerCase());
  // Convention-independent join so a camelCase signal can match snake_case code
  // (invoiceTotal ↔ invoice_total both normalize to "invoicetotal").
  tok.full.add(parts.join(""));
  for (const part of parts) tok.parts.add(part);
}

/**
 * Does a capability signal match the code tokens of a file?
 *
 * A single-word signal ("renewal") matches any identifier word-part; a compound
 * signal ("invoiceTotal", "invoice_total") matches when its normalized join is
 * present — so naming-convention differences across languages don't block it.
 */
export function signalMatches(signal: string, tok: CodeTokens): boolean {
  const s = signal.toLowerCase();
  if (tok.full.has(s)) return true;
  const parts = splitIdentifier(signal).map(singularize);
  if (parts.length === 1) return tok.parts.has(parts[0]);
  return tok.full.has(parts.join(""));
}

// ── Rung A: language-agnostic text analyzer ──────────────────────────────────

/** Keywords common across languages — legitimate words, useless as signals. */
const GENERIC_KEYWORDS = new Set([
  "export", "import", "function", "func", "def", "return", "const", "let",
  "var", "class", "struct", "interface", "type", "enum", "trait", "impl",
  "public", "private", "protected", "static", "final", "void", "null", "nil",
  "none", "true", "false", "if", "else", "elif", "for", "while", "switch",
  "case", "break", "continue", "new", "this", "self", "super", "async", "await",
  "yield", "throw", "throws", "try", "catch", "finally", "package", "namespace",
  "using", "include", "module", "from", "as", "in", "is", "and", "or", "not",
  "end", "begin", "then", "do", "lambda", "pass", "raise", "with", "where"
]);

function stripCommentsAndStrings(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ") // block comments
    .replace(/"(?:[^"\\]|\\.)*"/g, " ") // double-quoted strings (before // strip)
    .replace(/'(?:[^'\\]|\\.)*'/g, " ") // single-quoted strings
    .replace(/`(?:[^`\\]|\\.)*`/g, " ") // template strings
    .replace(/\/\/[^\n]*/g, " ") // line comments //
    .replace(/#[^\n]*/g, " "); // line comments #
}

export const textAnalyzer: CapacityAnalyzer = {
  name: "text",
  analyze(text: string): CodeTokens {
    const tok: CodeTokens = { full: new Set(), parts: new Set() };
    const code = stripCommentsAndStrings(text);
    for (const m of code.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      const id = m[0];
      if (GENERIC_KEYWORDS.has(id.toLowerCase())) continue;
      addIdentifier(tok, id);
    }
    return tok;
  }
};

// ── Rung B: TypeScript / JavaScript analyzer ─────────────────────────────────

export const typeScriptAnalyzer: CapacityAnalyzer = {
  name: "typescript",
  analyze(text: string, fileName: string): CodeTokens {
    const tok: CodeTokens = { full: new Set(), parts: new Set() };
    let source: ts.SourceFile;
    try {
      source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
    } catch {
      return textAnalyzer.analyze(text, fileName); // malformed → degrade gracefully
    }
    const visit = (node: ts.Node): void => {
      // Identifiers and private (#x) names are real code symbols; keywords,
      // comments, and string-literal contents are other node kinds / not nodes,
      // so they are excluded for free.
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
        addIdentifier(tok, node.text);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    return tok;
  }
};

// ── Rung C: tree-sitter analyzer (any language with a grammar) ───────────────

/**
 * Build a capacity analyzer over a ready tree-sitter parser (see treesitter.ts).
 * Collects leaf identifier nodes — `identifier`, `type_identifier`,
 * `field_identifier`, `property_identifier`, etc. — which across grammars are the
 * real code symbols. Keywords, comments, and string contents are other node
 * kinds, so they are excluded just as in the TypeScript analyzer.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function treeSitterAnalyzer(parser: any): CapacityAnalyzer {
  return {
    name: "tree-sitter",
    analyze(text: string): CodeTokens {
      const tok: CodeTokens = { full: new Set(), parts: new Set() };
      let tree: any; // eslint-disable-line @typescript-eslint/no-explicit-any
      try {
        tree = parser.parse(text);
      } catch {
        return tok;
      }
      const stack = [tree.rootNode];
      while (stack.length) {
        const node = stack.pop();
        if (!node) continue;
        if (node.childCount === 0) {
          if (typeof node.type === "string" && node.type.endsWith("identifier")) {
            addIdentifier(tok, node.text);
          }
        } else {
          for (let i = 0; i < node.childCount; i++) stack.push(node.child(i));
        }
      }
      tree.delete?.();
      return tok;
    }
  };
}

// ── Registry ─────────────────────────────────────────────────────────────────

const TS_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);

/** Pick the deepest analyzer available for a file extension. */
export function analyzerForExtension(ext: string): CapacityAnalyzer {
  if (TS_EXTENSIONS.has(ext)) return typeScriptAnalyzer;
  return textAnalyzer; // every other language gets the Rung-A treatment for now
}
