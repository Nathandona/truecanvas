import fs from "node:fs";
import path from "node:path";
import { parseModule, walk, type t } from "./ast.js";
import { importSpecifier } from "./catalog.js";
import type { TruecanvasConfig } from "./config.js";
import { EditError, componentNamesIn, indentBlock } from "./edit.js";
import { reindex } from "./parse.js";
import { layoutFiles, repoint, routeOf } from "./routes.js";
import { defaultReturn, parseModuleDoc, parseSourceDoc } from "./source.js";
import type { CanvasDoc, CanvasFrame, CanvasNode } from "./types.js";

/*
 * Linked frames: `<Frame name="Home" page="src/app/page.tsx">` renders the real
 * page (and its layouts) by importing them, and its layers are the JSX of
 * those files. Edits on those layers go to the page and layout files.
 */

const flatten = (n: CanvasNode): CanvasNode[] => (n.kind === "fragment" ? n.children : [n]);

/** Canvas nodes that wrap the page in a linked frame: layouts (outermost first), then the page component. */
function wrapperChain(frame: CanvasNode): CanvasNode[] {
  const chain: CanvasNode[] = [];
  for (let n = frame; ; ) {
    const kids = n.children.filter((c) => c.kind !== "text");
    if (kids.length !== 1 || kids[0].kind !== "component") return chain;
    chain.push(kids[0]);
    n = kids[0];
  }
}

function readSource(config: TruecanvasConfig, rel: string): string | null {
  try {
    return fs.readFileSync(path.join(config.root, rel), "utf8");
  } catch {
    return null;
  }
}

/** Replaces linked frames' layers with the JSX of their page and layouts. Returns a new doc. */
export function resolveLinks(config: TruecanvasConfig, doc: CanvasDoc): CanvasDoc {
  if (!doc.frames.some((f) => f.page || f.component)) return doc;
  return { ...doc, frames: doc.frames.map((f) => (f.component ? linkComponent(config, f) : f.page ? linkFrame(config, f) : f)) };
}

/** "components/button.tsx#Button" → file and export name. */
export function splitComponentRef(ref: string): { file: string; name: string } {
  const i = ref.lastIndexOf("#");
  return i > 0 ? { file: ref.slice(0, i), name: ref.slice(i + 1) } : { file: ref, name: "default" };
}

/** A main component frame: its layers are the JSX the component returns, edits go to its file. */
function linkComponent(config: TruecanvasConfig, original: CanvasFrame): CanvasFrame {
  const frame: CanvasFrame = { ...original };
  const { file, name } = splitComponentRef(frame.component!);
  const source = readSource(config, file);
  const doc = source === null ? null : parseModuleDoc(file, source);
  const own = doc?.frames.find((f) => f.frameName === name);
  if (!own) {
    frame.link = { kind: "component", page: file, route: name, files: [], editable: false, reason: source === null ? `${file} doesn't exist anymore.` : `${file} has no exported component ${name} returning JSX.` };
    return frame;
  }
  frame.children = flatten(own.children[0]);
  reindex(frame, frame.path);
  frame.link = { kind: "component", page: file, route: name, files: [file], editable: true };
  return frame;
}

function linkFrame(config: TruecanvasConfig, original: CanvasFrame): CanvasFrame {
  const frame: CanvasFrame = { ...original };
  const page = frame.page!;
  const route = routeOf(config, page);
  const pageSource = readSource(config, page);
  if (pageSource === null) {
    frame.link = { page, route, files: [], editable: false, reason: `${page} doesn't exist anymore.` };
    return frame;
  }
  const chain = wrapperChain(original);
  const files: string[] = [];
  let current: CanvasNode[];
  const pageDoc = parseSourceDoc(page, pageSource, false);
  if (pageDoc) {
    current = flatten(pageDoc.frames[0].children[0]);
    files.push(page);
  } else {
    // data or logic in the page: show the page component as one layer
    current = chain.length ? [chain[chain.length - 1]] : original.children;
  }
  const layouts = layoutFiles(config, page);
  layouts.forEach((rel, i) => {
    const src = readSource(config, rel);
    const ldoc = src === null ? null : parseSourceDoc(rel, src, true);
    const root = ldoc?.frames[0].children[0];
    const slot = root && findSlot(root);
    if (root && slot) {
      slot.parent.children.splice(slot.index, 1, ...current);
      current = flatten(root);
      files.push(rel);
    } else {
      // the canvas node that renders this layout (chain: outermost layout first)
      const wrapper = chain[layouts.length - 1 - i];
      if (wrapper) current = [{ ...wrapper, children: current }];
    }
  });
  frame.children = current;
  reindex(frame, frame.path);
  frame.link = pageDoc
    ? { page, route, files, editable: true }
    : { page, route, files, editable: false, reason: "This page fetches data or has logic before its return, so it's shown as one layer. Explore a copy to design on it." };
  return frame;
}

/** The `{children}` slot of a layout's JSX. */
function findSlot(root: CanvasNode): { parent: CanvasNode; index: number } | null {
  for (const [i, c] of root.children.entries()) {
    if (c.kind === "expression" && c.name.trim() === "children") return { parent: root, index: i };
    const deeper = findSlot(c);
    if (deeper) return deeper;
  }
  return null;
}

const pascal = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");

/** A local name not used in the canvas yet. */
function uniqueName(doc: CanvasDoc, taken: Set<string>, base: string) {
  const used = new Set([...doc.declared, ...doc.imports.flatMap((i) => [...i.names, ...(i.defaultName ? [i.defaultName] : [])]), ...taken, "Canvas", "Frame"]);
  let name = /^[A-Z]/.test(base) ? base : `Page${base}`;
  for (let n = 2; used.has(name); n++) name = `${base}${n}`;
  taken.add(name);
  return name;
}

/** Default-import name of a module, reusing the canvas' existing import of it. */
function importName(config: TruecanvasConfig, doc: CanvasDoc, canvasRel: string, file: string, base: string, taken: Set<string>, imports: string[]) {
  const spec = importSpecifier(config.root, canvasRel, file);
  const existing = doc.imports.find((i) => i.source === spec && i.defaultName);
  if (existing) return existing.defaultName!;
  const name = uniqueName(doc, taken, base);
  imports.push(`import ${name} from ${JSON.stringify(spec)};`);
  return name;
}

/** Imports and frame body of a linked frame for a page. */
export function linkedFrameBody(config: TruecanvasConfig, doc: CanvasDoc, canvasRel: string, page: string): { imports: string[]; jsx: string } {
  const taken = new Set<string>();
  const imports: string[] = [];
  const route = routeOf(config, page);
  const segments = route.split("/").filter(Boolean);
  const pageName = importName(config, doc, canvasRel, page, `${segments.length ? pascal(segments[segments.length - 1]) : "Home"}Page`, taken, imports);
  let jsx = `<${pageName} />`;
  for (const rel of layoutFiles(config, page)) {
    const dir = path.basename(path.dirname(rel));
    const name = importName(config, doc, canvasRel, rel, `${pascal(dir) || "Route"}Layout`, taken, imports);
    jsx = `<${name}>\n${indentBlock(jsx)}\n</${name}>`;
  }
  return { imports, jsx };
}

/** Removes `<>`/`</>` around JSX and normalizes its indentation. */
function unwrapFragment(jsx: string): string {
  let code = jsx.trim();
  if (code.startsWith("<>") && code.endsWith("</>")) code = code.slice(2, -3).trim();
  return dedent(code);
}

/** Dedents lines 2..n to the smallest indent (line 1 is assumed already trimmed). */
export function dedent(code: string): string {
  const lines = code.split("\n");
  const rest = lines.slice(1).filter((l) => l.trim());
  const base = rest.length ? Math.min(...rest.map((l) => /^[ \t]*/.exec(l)![0].length)) : 0;
  return [lines[0], ...lines.slice(1).map((l) => (l.trim() ? l.slice(base) : ""))].join("\n");
}

/**
 * Frame body for "Explore a copy" of a linked frame: the page's JSX inline (so
 * every section is a free layer), still wrapped in the page's layouts.
 */
export function explorationBody(config: TruecanvasConfig, frame: CanvasFrame, canvasRel: string): { imports: string[]; jsx: string; inline: boolean } {
  if (frame.component) throw new EditError(`"${frame.frameName}" is a main component: edit it directly, every instance follows.`);
  if (!frame.page) throw new EditError(`"${frame.frameName}" isn't linked to a page.`);
  const pageAbs = path.join(config.root, frame.page);
  const source = readSource(config, frame.page);
  if (source === null) throw new EditError(`${frame.page} doesn't exist anymore.`);
  const chain = wrapperChain(frame);
  const wrappers = chain.slice(0, -1).map((n) => n.name);
  const info = defaultReturn(source, false);
  const imports: string[] = [];
  let jsx: string;
  if (info?.pure) {
    for (const stmt of info.ast.program.body) {
      if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type" || /\.(css|scss|sass|less)$/.test(stmt.source.value)) continue;
      const src = stmt.source.value;
      const from = repoint(config, src, pageAbs, path.join(config.root, canvasRel));
      const text = source.slice(stmt.start!, stmt.end!);
      imports.push(from === src ? text : text.replace(JSON.stringify(src), JSON.stringify(from)).replace(`'${src}'`, `'${from}'`));
    }
    jsx = unwrapFragment(source.slice(info.node.start!, info.node.end!));
  } else {
    jsx = chain.length ? `<${chain[chain.length - 1].name} />` : "";
  }
  for (const w of [...wrappers].reverse()) jsx = `<${w}>\n${indentBlock(jsx)}\n</${w}>`;
  return { imports, jsx, inline: !!info?.pure };
}

/** What "Apply to page" writes: the exploration's page JSX and the imports it needs, written for the page file. */
export function applyPlan(config: TruecanvasConfig, canvasSource: string, doc: CanvasDoc, frame: CanvasFrame, canvasRel: string): { page: string; jsx: string; imports: string[] } {
  const page = frame.from;
  if (!page) throw new EditError(`"${frame.frameName}" isn't an exploration of a page. Explore a copy of a linked frame first.`);
  if (!fs.existsSync(path.join(config.root, page))) throw new EditError(`${page} doesn't exist anymore.`);
  // step inside the layout wrappers: only the page's own content is written back
  const layoutSpecs = new Set(doc.imports.filter((i) => /(^|\/)layout(\.\w+)?$/.test(i.source)).flatMap((i) => [...i.names, ...(i.defaultName ? [i.defaultName] : [])]));
  let content = frame.children;
  for (;;) {
    const kids = content.filter((c) => c.kind !== "text" || c.text?.trim());
    if (kids.length === 1 && kids[0].kind === "component" && layoutSpecs.has(kids[0].name)) content = kids[0].children;
    else break;
  }
  content = content.filter((c) => !(c.kind === "text" && !c.text?.trim()));
  if (!content.length) throw new EditError(`"${frame.frameName}" is empty: there's nothing to apply.`);
  const body = dedent(canvasSource.slice(content[0].start, content[content.length - 1].end));
  const single = content.length === 1 && content[0].kind !== "text" && content[0].kind !== "expression";
  const jsx = single ? body : `<>\n${indentBlock(body)}\n</>`;

  // imports the page needs, re-pointed from the canvas to the page file
  const ast = parseModule(canvasSource);
  const imports: string[] = [];
  for (const name of componentNamesIn(jsx)) {
    const decl = ast.program.body.find(
      (s): s is t.ImportDeclaration => s.type === "ImportDeclaration" && s.importKind !== "type" && s.specifiers.some((sp) => sp.local.name === name),
    );
    if (!decl) {
      if (doc.declared.includes(name)) throw new EditError(`<${name}> is defined in the canvas file itself. Move it to a component file before applying.`);
      continue;
    }
    const sp = decl.specifiers.find((x) => x.local.name === name)!;
    const from = repoint(config, decl.source.value, path.join(config.root, canvasRel), path.join(config.root, page));
    const what =
      sp.type === "ImportDefaultSpecifier"
        ? name
        : sp.type === "ImportNamespaceSpecifier"
          ? `* as ${name}`
          : `{ ${sp.imported.type === "Identifier" && sp.imported.name !== name ? `${sp.imported.name} as ${name}` : name} }`;
    imports.push(`import ${what} from ${JSON.stringify(from)};`);
  }
  return { page, jsx, imports };
}

/**
 * Drops imports that are no longer referenced in code, among `candidates`
 * (component names the page used before an apply). Mentions in comments don't
 * count. Other imports are left alone.
 */
export function pruneImports(source: string, candidates: Set<string>): string {
  let ast: t.File;
  try {
    ast = parseModule(source);
  } catch {
    return source;
  }
  const used = new Set<string>();
  for (const stmt of ast.program.body) {
    if (stmt.type === "ImportDeclaration") continue;
    walk(stmt, (n) => {
      if (n.type === "Identifier" || n.type === "JSXIdentifier") used.add(n.name);
    });
  }
  let out = source;
  const decls = ast.program.body.filter((s): s is t.ImportDeclaration => s.type === "ImportDeclaration" && s.specifiers.length > 0);
  for (const decl of [...decls].reverse()) {
    const names = decl.specifiers.map((s) => s.local.name);
    if (!names.every((n) => candidates.has(n) && !used.has(n))) continue;
    let end = decl.end!;
    if (out[end] === "\n") end++;
    out = out.slice(0, decl.start!) + out.slice(end);
  }
  return out;
}
