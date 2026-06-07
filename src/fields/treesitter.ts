/**
 * Tree-sitter loader — real multi-language parsing for capacity (Rung C).
 *
 * Uses `web-tree-sitter` (wasm, no native build) with prebuilt grammar wasms
 * from `tree-sitter-wasms`. Everything is local: grammar files ship on disk and
 * nothing touches the network at run time — the local-first trust property holds.
 *
 * Grammars are loaded lazily and cached: a scan only pays to load a language if
 * the repo actually contains files in it. JS/TS keep the TypeScript-compiler
 * analyzer (better for them and already a dependency); this covers the rest.
 *
 * Adding a language is one line in EXT_TO_LANG (given a grammar wasm exists).
 */
import { createRequire } from "node:module";

// web-tree-sitter's typings are awkward under NodeNext; treat the module as
// dynamic. It is isolated here so the `any` does not leak into the engine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const require = createRequire(import.meta.url);

/** Map a file extension to a tree-sitter grammar name (wasm stem). */
const EXT_TO_LANG: Record<string, string> = {
  ".py": "python",
  ".go": "go",
  ".rb": "ruby",
  ".java": "java",
  ".rs": "rust",
  ".php": "php",
  ".cs": "c_sharp"
};

export function treeSitterLangForExt(ext: string): string | undefined {
  return EXT_TO_LANG[ext];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyParser = any;

let parserModule: AnyParser | null = null;
let initPromise: Promise<AnyParser> | null = null;
const languageCache = new Map<string, AnyParser>();

async function getParserClass(): Promise<AnyParser> {
  if (!initPromise) {
    initPromise = (async () => {
      const mod = (await import("web-tree-sitter")) as AnyParser;
      const Parser = mod.default ?? mod;
      await Parser.init();
      parserModule = Parser;
      return Parser;
    })();
  }
  return initPromise;
}

async function loadLanguage(lang: string): Promise<AnyParser | null> {
  if (languageCache.has(lang)) return languageCache.get(lang);
  try {
    const Parser = await getParserClass();
    const wasmPath = require.resolve(`tree-sitter-wasms/out/tree-sitter-${lang}.wasm`);
    const language = await Parser.Language.load(wasmPath);
    languageCache.set(lang, language);
    return language;
  } catch {
    return null; // grammar missing or ABI mismatch → caller falls back
  }
}

/** A ready-to-use parser for a language, or null if it could not be loaded. */
export async function makeParser(lang: string): Promise<AnyParser | null> {
  const language = await loadLanguage(lang);
  if (!language || !parserModule) return null;
  const parser = new parserModule();
  parser.setLanguage(language);
  return parser;
}
