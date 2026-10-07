import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { globSync } from "tinyglobby";
import type TS from "typescript";
import type { ComponentSpec, PropSpec } from "./types.js";
import { posix } from "./paths.js";

const require = createRequire(import.meta.url);

/**
 * Reads component prop types with the TypeScript checker. The program is
 * created on demand and dropped right after, so only the small JSON result
 * stays in memory; it is rebuilt when component files change.
 */
export class Catalog {
  private cache: ComponentSpec[] | null = null;
  private loading: Promise<ComponentSpec[]> | null = null;
  private generation = 0;

  constructor(
    private root: string,
    private globs: string[],
    private libraries: string[] = [],
  ) {}

  invalidate() {
    this.generation++;
    this.cache = null;
    this.loading = null;
  }

  /** Cached components; call load() first. */
  list(): ComponentSpec[] {
    return this.cache ?? [];
  }

  get(name: string): ComponentSpec | undefined {
    return this.list().find((c) => c.name === name);
  }

  /**
   * Analyzes components in a short-lived worker thread: the TypeScript program
   * is large, and a worker gives all of that memory back when it exits.
   */
  load(): Promise<ComponentSpec[]> {
    if (this.cache) return Promise.resolve(this.cache);
    if (this.loading) return this.loading;
    const gen = this.generation;
    const job = runAnalysis(this.root, this.globs, this.libraries).then((list) => {
      if (gen === this.generation) this.cache = list;
      return list;
    });
    const pending: Promise<ComponentSpec[]> = job.finally(() => {
      if (this.loading === pending) this.loading = null;
    });
    pending.catch(() => {}); // callers handle errors from `job`; never crash the process
    this.loading = pending;
    return job;
  }
}

async function runAnalysis(root: string, globs: string[], libraries: string[]): Promise<ComponentSpec[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const worker = [path.join(here, "catalog-worker.js"), path.join(here, "..", "catalog-worker.js")].find((p) => fs.existsSync(p));
  if (!worker) return analyzeComponents(root, globs, libraries);
  const { Worker } = await import("node:worker_threads");
  return new Promise((resolve, reject) => {
    const w = new Worker(worker, { workerData: { root, globs, libraries } });
    w.once("message", (m: { ok: boolean; list?: ComponentSpec[]; error?: string }) => (m.ok ? resolve(m.list!) : reject(new Error(m.error))));
    w.once("error", reject);
    w.once("exit", (code) => code !== 0 && reject(new Error(`catalog worker exited with ${code}`)));
  });
}

export async function analyzeComponents(root: string, globs: string[], libraries: string[] = []): Promise<ComponentSpec[]> {
  const ts = require("typescript") as typeof TS;
  const files = globSync(globs, { cwd: root, absolute: true, ignore: ["**/node_modules/**", "**/*.canvas.tsx", "**/*.test.*", "**/*.stories.*"] });
  const options = compilerOptions(ts, root);
  // resolve each library's type entry the way the project would import it
  const libEntries = new Map<string, string>();
  for (const lib of libraries) {
    const res = ts.resolveModuleName(lib, path.join(root, "index.ts"), options, ts.sys).resolvedModule;
    if (res) libEntries.set(res.resolvedFileName, lib);
  }
  const program = ts.createProgram({ rootNames: [...files, ...libEntries.keys()], options });
  const checker = program.getTypeChecker();
  const out: ComponentSpec[] = [];
  for (const file of [...files, ...libEntries.keys()]) {
    const library = libEntries.get(file);
    const sf = program.getSourceFile(file);
    if (!sf) continue;
    const moduleSymbol = checker.getSymbolAtLocation(sf);
    if (!moduleSymbol) continue;
    const named = new Set<string>();
    const found: ComponentSpec[] = [];
    for (let sym of checker.getExportsOfModule(moduleSymbol)) {
      const exported = sym.getName();
      if (sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
      const decl = sym.valueDeclaration ?? sym.declarations?.[0];
      if (!decl) continue;
      // `export default function Hero()` is a symbol named "default": the function's own name is the component's
      const own = (decl as TS.Declaration & { name?: TS.Node }).name;
      const name = sym.getName() === "default" && own && ts.isIdentifier(own) ? own.text : sym.getName();
      if (!/^[A-Z]/.test(name) || !(sym.flags & ts.SymbolFlags.Value)) continue;
      const type = checker.getTypeOfSymbolAtLocation(sym, decl);
      const sig = type.getCallSignatures()[0];
      if (!sig) continue;
      const ret = checker.typeToString(sig.getReturnType());
      // async server components cannot render inside a client canvas
      if (!/Element|ReactNode|ReactPortal|null|any/.test(ret) || /^Promise</.test(ret)) continue;
      const spec = { ...describe(ts, checker, sym, decl, sig, library ?? posix(path.relative(root, file)), library), name };
      if (exported === "default") spec.defaultExport = true;
      else named.add(spec.name);
      found.push(spec);
    }
    // `export function Hero` + `export default Hero`: the named import is the one to use
    out.push(...found.filter((s) => !(s.defaultExport && named.has(s.name))));
  }
  for (const spec of out) applyProfile(spec);
  if (libraries.length) await attachPresets(root, out);
  out.sort((a, b) => (a.library ?? "").localeCompare(b.library ?? "") || a.name.localeCompare(b.name));
  return out;
}

/** How known libraries should look in the inspector: internals hidden, knobs grouped. */
const LIBRARY_PROFILES: Record<string, { hidden: string[]; advanced: string[] }> = {
  "@paper-design/shaders-react": {
    hidden: ["minPixelRatio", "maxPixelCount", "webGlContextAttributes", "frame", "width", "height", "children", "style"],
    advanced: ["fit", "scale", "rotation", "originX", "originY", "offsetX", "offsetY", "worldWidth", "worldHeight"],
  },
};

function applyProfile(spec: ComponentSpec) {
  const profile = spec.library ? LIBRARY_PROFILES[spec.library] : undefined;
  if (!profile) return;
  spec.props = spec.props.filter((p) => !profile.hidden.includes(p.name));
  if (profile.hidden.includes("children")) spec.acceptsChildren = false;
  for (const p of spec.props) if (profile.advanced.includes(p.name)) p.advanced = true;
}

/**
 * Libraries like @paper-design/shaders-react export `<name>Presets` arrays of
 * `{ name, params }`. We load the package to read them, and use the "Default"
 * preset as each prop's default.
 */
async function attachPresets(root: string, specs: ComponentSpec[]) {
  const byLib = new Map<string, ComponentSpec[]>();
  for (const s of specs) if (s.library) byLib.set(s.library, [...(byLib.get(s.library) ?? []), s]);
  const projectRequire = createRequire(path.join(root, "package.json"));
  for (const [lib, list] of byLib) {
    let mod: Record<string, unknown>;
    try {
      const { pathToFileURL } = await import("node:url");
      mod = await import(pathToFileURL(projectRequire.resolve(lib)).href);
    } catch {
      continue;
    }
    for (const spec of list) {
      const raw = mod[`${spec.name[0].toLowerCase()}${spec.name.slice(1)}Presets`];
      if (!Array.isArray(raw)) continue;
      const known = new Set(spec.props.map((p) => p.name));
      spec.presets = raw
        .filter((p): p is { name: string; params: Record<string, unknown> } => !!p && typeof p.name === "string" && typeof p.params === "object")
        .map((p) => ({
          name: p.name,
          props: Object.fromEntries(Object.entries(p.params).filter(([k, v]) => known.has(k) && k !== "frame" && isLiteral(v))) as NonNullable<ComponentSpec["presets"]>[number]["props"],
        }));
      const def = spec.presets.find((p) => p.name === "Default") ?? spec.presets[0];
      if (def) for (const prop of spec.props) if (prop.default === undefined && prop.name in def.props) prop.default = def.props[prop.name];
    }
  }
}

function isLiteral(v: unknown): boolean {
  if (Array.isArray(v)) return v.every((x) => ["string", "number", "boolean"].includes(typeof x));
  return ["string", "number", "boolean"].includes(typeof v);
}

function compilerOptions(ts: typeof TS, root: string): TS.CompilerOptions {
  const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
  const base: TS.CompilerOptions = { jsx: ts.JsxEmit.ReactJSX, strict: true, skipLibCheck: true, noEmit: true, allowJs: false };
  if (!configPath) return base;
  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
  return { ...parsed.options, noEmit: true, skipLibCheck: true, incremental: false, plugins: [] };
}

function describe(ts: typeof TS, checker: TS.TypeChecker, sym: TS.Symbol, decl: TS.Declaration, sig: TS.Signature, file: string, library?: string): ComponentSpec {
  const props: PropSpec[] = [];
  const param = sig.getParameters()[0];
  const defaults = readDefaults(ts, decl);
  let acceptsClassName = false;
  let acceptsChildren = false;
  if (param) {
    const paramType = checker.getTypeOfSymbolAtLocation(param, decl);
    for (const prop of paramType.getProperties()) {
      const name = prop.getName();
      if (name === "key" || name === "ref") continue;
      const decls = prop.getDeclarations() ?? [];
      // project components: props declared in the project; library components: props
      // declared by the library itself (not the hundreds of inherited DOM attributes)
      const own = decls.some((d) => {
        const f = d.getSourceFile().fileName;
        return library ? !/node_modules\/(@types\/react|typescript)\//.test(f) && !f.includes("/csstype/") : !f.includes("node_modules");
      });
      if (name === "className") acceptsClassName = true;
      if (name === "children") acceptsChildren = true;
      if (!own && name !== "children") continue;
      const propType = checker.getTypeOfSymbolAtLocation(prop, decls[0] ?? decl);
      const spec = classify(ts, checker, propType, name);
      if (spec.options) spec.options = declaredOrder(ts, checker, decls[0], spec.options);
      const description = ts.displayPartsToString(prop.getDocumentationComment(checker)) || undefined;
      const range = spec.type === "number" ? readRange(name, description, decls[0]) : undefined;
      props.push({
        name,
        ...spec,
        ...range,
        optional: !!(prop.flags & ts.SymbolFlags.Optional),
        default: defaults[name],
        description,
      });
    }
  }
  return {
    name: sym.getName(),
    file,
    library,
    description: ts.displayPartsToString(sym.getDocumentationComment(checker)) || undefined,
    props,
    acceptsClassName,
    acceptsChildren,
  };
}

/** Numeric ranges written in docs, e.g. "(0 to 1)" in JSDoc or "u_distortion (float): … (0 to 1)". */
function readRange(name: string, description: string | undefined, decl: TS.Declaration | undefined): { min: number; max: number } | undefined {
  const re = /\((-?\d+(?:\.\d+)?)\s*(?:to|-|–|\.\.)\s*(-?\d+(?:\.\d+)?)\)/;
  const fromDoc = description && re.exec(description);
  if (fromDoc) return { min: Number(fromDoc[1]), max: Number(fromDoc[2]) };
  const text = decl?.getSourceFile().text;
  if (!text) return undefined;
  const line = new RegExp(`\\bu_${name}\\b[^\\n]*`).exec(text)?.[0];
  const m = line && re.exec(line);
  return m ? { min: Number(m[1]), max: Number(m[2]) } : undefined;
}

function classify(ts: typeof TS, checker: TS.TypeChecker, type: TS.Type, name = ""): Omit<PropSpec, "name" | "optional" | "default" | "description"> {
  const typeText = checker.typeToString(type, undefined, ts.TypeFormatFlags.NoTruncation);
  const parts = type.isUnion() ? type.types : [type];
  const real = parts.filter((p) => !(p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void)));
  // colors: by name, since in TypeScript they are just strings
  if (/colou?rs$/i.test(name) && /string\[\]|readonly string\[\]/.test(typeText)) return { type: "colors", typeText };
  if (/colou?r/i.test(name) && real.length && real.every((p) => p.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral))) return { type: "color", typeText };
  if (/ReactNode|ReactElement|JSX\.Element/.test(typeText)) return { type: "node", typeText };
  if (real.length && real.every((p) => p.flags & ts.TypeFlags.BooleanLike)) return { type: "boolean", typeText };
  if (real.length && real.every((p) => p.isStringLiteral())) {
    return { type: "enum", options: real.map((p) => (p as TS.StringLiteralType).value), typeText };
  }
  if (real.length === 1 && real[0].flags & ts.TypeFlags.String) return { type: "string", typeText };
  if (real.length === 1 && real[0].flags & ts.TypeFlags.Number) return { type: "number", typeText };
  if (real.some((p) => p.getCallSignatures().length)) return { type: "function", typeText };
  if (real.length && real.every((p) => p.flags & (ts.TypeFlags.String | ts.TypeFlags.StringLiteral))) return { type: "string", typeText };
  if (real.length && real.every((p) => p.flags & (ts.TypeFlags.Number | ts.TypeFlags.NumberLiteral))) return { type: "number", typeText };
  return { type: "other", typeText };
}

/** Union members in the order they are written (the checker normalizes order). */
function declaredOrder(ts: typeof TS, checker: TS.TypeChecker, decl: TS.Declaration | undefined, options: string[]): string[] {
  let typeNode = decl && (ts.isPropertySignature(decl) || ts.isPropertyDeclaration(decl)) ? decl.type : undefined;
  for (let hops = 0; typeNode && hops < 5; hops++) {
    if (ts.isUnionTypeNode(typeNode)) {
      const order: string[] = [];
      for (const member of typeNode.types) {
        if (ts.isLiteralTypeNode(member) && ts.isStringLiteral(member.literal)) order.push(member.literal.text);
        else if (ts.isTypeReferenceNode(member)) {
          const t = checker.getTypeFromTypeNode(member);
          for (const u of t.isUnion() ? t.types : [t]) if (u.isStringLiteral()) order.push(u.value);
        }
      }
      const known = order.filter((o) => options.includes(o));
      return [...new Set([...known, ...options])];
    }
    if (ts.isTypeReferenceNode(typeNode)) {
      const sym = checker.getSymbolAtLocation(typeNode.typeName);
      const target = sym && sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
      const alias = target?.declarations?.find(ts.isTypeAliasDeclaration);
      typeNode = alias?.type;
    } else if (ts.isParenthesizedTypeNode(typeNode)) typeNode = typeNode.type;
    else break;
  }
  return options;
}

/** Destructuring defaults: `function X({ size = "md", open = false })`. */
function readDefaults(ts: typeof TS, decl: TS.Declaration): Record<string, string | number | boolean> {
  let fn: TS.SignatureDeclaration | undefined;
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl) || ts.isArrowFunction(decl)) fn = decl;
  else if (ts.isVariableDeclaration(decl) && decl.initializer) {
    let init: TS.Expression = decl.initializer;
    // forwardRef(...) / memo(...)
    while (ts.isCallExpression(init) && init.arguments[0]) init = init.arguments[0];
    if (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) fn = init;
  }
  const out: Record<string, string | number | boolean> = {};
  const first = fn?.parameters[0];
  if (!first || !ts.isObjectBindingPattern(first.name)) return out;
  for (const el of first.name.elements) {
    if (!el.initializer) continue;
    const key = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : ts.isIdentifier(el.name) ? el.name.text : null;
    if (!key) continue;
    const init = el.initializer;
    if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) out[key] = init.text;
    else if (ts.isNumericLiteral(init)) out[key] = Number(init.text);
    else if (init.kind === ts.SyntaxKind.TrueKeyword) out[key] = true;
    else if (init.kind === ts.SyntaxKind.FalseKeyword) out[key] = false;
  }
  return out;
}

/** The import specifier a canvas file should use for a component file. */
export function importSpecifier(root: string, canvasFile: string, componentFile: string): string {
  // library components are imported by package name
  if (!/\.(tsx|ts|jsx|js)$/.test(componentFile) && !componentFile.startsWith(".")) return componentFile;
  const abs = path.resolve(root, componentFile);
  const noExt = posix(abs).replace(/\.(tsx|ts|jsx|js)$/, "").replace(/\/index$/, "");
  const alias = readAlias(root);
  if (alias) {
    const rel = path.relative(alias.dir, noExt);
    if (!rel.startsWith("..")) return `${alias.prefix}${posix(rel)}`;
  }
  let rel = posix(path.relative(path.dirname(path.resolve(root, canvasFile)), noExt));
  if (!rel.startsWith(".")) rel = `./${rel}`;
  return rel;
}

/** A path written with the project's import alias (`@/components/ui`), as a folder on disk. */
export function resolveAliasPath(root: string, spec: string): string {
  const alias = readAlias(root);
  if (alias && spec.startsWith(alias.prefix)) return path.join(alias.dir, spec.slice(alias.prefix.length));
  return path.resolve(root, spec);
}

let aliasCache: { key: string; value: { prefix: string; dir: string } | null } | null = null;
/** The project's `@/*`-style alias, re-read whenever tsconfig.json changes. */
function readAlias(root: string) {
  const configFile = path.join(root, "tsconfig.json");
  let key = `${root}\0none`;
  try {
    key = `${root}\0${fs.statSync(configFile).mtimeMs}`;
  } catch {
    // no tsconfig at the root: findConfigFile may still find one above
  }
  if (aliasCache?.key === key) return aliasCache.value;
  let value: { prefix: string; dir: string } | null = null;
  try {
    const ts = require("typescript") as typeof TS;
    const configPath = ts.findConfigFile(root, ts.sys.fileExists, "tsconfig.json");
    if (configPath) {
      const read = ts.readConfigFile(configPath, ts.sys.readFile);
      const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, path.dirname(configPath));
      const paths = parsed.options.paths ?? {};
      const base = (parsed.options.pathsBasePath as string | undefined) ?? parsed.options.baseUrl ?? path.dirname(configPath);
      for (const [k, targets] of Object.entries(paths)) {
        if (k.endsWith("/*") && targets[0]?.endsWith("/*")) {
          value = { prefix: k.slice(0, -1), dir: path.resolve(base, targets[0].slice(0, -2)) };
          break;
        }
      }
    }
  } catch {
    value = null;
  }
  aliasCache = { key, value };
  return value;
}
