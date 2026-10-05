import MagicString from "magic-string";
import { parseModule, jsxName, walk } from "./ast.js";
import { findByPath, findFrame, findNode, parseCanvas } from "./parse.js";
import type { CanvasDoc, CanvasFrame, CanvasNode } from "./types.js";

export type Literal = string | number | boolean | null | (string | number | boolean)[];

export class EditError extends Error {}

/** Formats a literal as a JSX attribute: `name="v"`, `name={1}`, `name`. */
export function attrCode(name: string, value: Literal): string {
  if (value === true) return name;
  if (typeof value === "string") {
    // JSX attribute strings decode HTML entities and can't hold quotes: use an expression then
    return /["\n\\{}&]/.test(value) ? `${name}={${JSON.stringify(value)}}` : `${name}="${value}"`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new EditError(`Invalid number for ${name}.`);
  if (Array.isArray(value)) return `${name}={[${value.map((v) => JSON.stringify(v)).join(", ")}]}`;
  return `${name}={${JSON.stringify(value)}}`;
}

const PROP_NAME = /^[A-Za-z_$][\w$-]*(:[\w$-]+)?$/;

/** Formats text as a JSX child; falls back to a string expression when it needs escaping. */
export function textCode(text: string): string {
  if (text === "") return "";
  if (/[{}<>&\n]/.test(text) || /^\s|\s$/.test(text)) return `{${JSON.stringify(text)}}`;
  return text;
}

/**
 * One editing session over a canvas source. Each method describes a change
 * against the *original* positions; `result()` gives the new source.
 */
export class CanvasEditor {
  readonly s: MagicString;
  /** Path of the node that should be selected after the edit (best effort, before formatting). */
  selectPaths: number[][] = [];
  private usedFrameNames: Set<string> | null = null;
  private placed: { x: number; y: number; width: number; height: number }[] | null = null;

  constructor(readonly source: string, readonly doc: CanvasDoc) {
    this.s = new MagicString(source);
  }

  node(id: string) {
    const found = findNode(this.doc, id);
    if (!found) throw new EditError(`Node ${id} not found. Re-read the canvas, ids change after every edit.`);
    return found;
  }

  frame(ref: string): CanvasFrame {
    const f = findFrame(this.doc, ref);
    if (!f) throw new EditError(`Frame "${ref}" not found. Available: ${this.doc.frames.map((x) => `"${x.frameName}"`).join(", ")}`);
    return f;
  }

  /** A frame id/name or a node id: whatever an agent passes as "parent". */
  container(ref: string): CanvasNode {
    const f = findFrame(this.doc, ref);
    if (f) return f;
    const n = this.node(ref).node;
    if (n.kind === "text" || n.kind === "expression") throw new EditError(`${ref} is a ${n.kind} node and cannot have children.`);
    return n;
  }

  setProp(node: CanvasNode, name: string, value: Literal | undefined, opts: { raw?: string } = {}) {
    if (node.kind !== "component" && node.kind !== "element") throw new EditError(`Cannot set props on a ${node.kind} node.`);
    if (!PROP_NAME.test(name) || name === "data-tc") throw new EditError(`Invalid prop name "${name}".`);
    const existing = node.attrs.find((a) => a.name === name);
    // cn("…", className): edit the static classes, keep the call
    if (existing?.literal && opts.raw === undefined && (typeof value === "string" || value === null)) {
      this.s.overwrite(existing.literal.start, existing.literal.end, JSON.stringify(value ?? ""));
      return;
    }
    const code = opts.raw !== undefined ? `${name}={${opts.raw}}` : value === null || value === undefined ? null : attrCode(name, value);
    if (existing) {
      if (code === null) {
        // remove including the whitespace before it
        let start = existing.start;
        while (start > 0 && /\s/.test(this.source[start - 1])) start--;
        this.s.remove(start, existing.end);
      } else {
        // contentOnly: keep anything inserted next to it in the same edit
        this.s.overwrite(existing.start, existing.end, code, { contentOnly: true });
      }
    } else if (code !== null) {
      const at = node.attrs.length ? node.attrs[node.attrs.length - 1].end : node.nameEnd;
      // attached to what follows, so changing or removing the last attribute in the same edit keeps it
      this.s.appendRight(at, ` ${code}`);
    }
  }

  setText(node: CanvasNode, text: string) {
    if (node.kind === "text") {
      // keep the whitespace around the text: it is significant in JSX
      this.s.overwrite(this.contentStart(node), this.contentEnd(node), textCode(text) || '{""}');
      return;
    }
    if (node.kind !== "component" && node.kind !== "element") throw new EditError(`Cannot set text on a ${node.kind} node.`);
    if (node.children.some((c) => c.kind !== "text")) {
      throw new EditError(`Node ${node.id} has element children; edit a text child instead.`);
    }
    const code = textCode(text);
    if (node.selfClosing) {
      // `<X a />` → `<X a>text</X>`
      let end = node.openEnd - 2;
      while (/\s/.test(this.source[end - 1])) end--;
      this.s.overwrite(end, node.openEnd, `>${code}</${node.name}>`);
    } else if (node.openEnd === node.closeStart) {
      this.s.appendLeft(node.openEnd, code);
    } else {
      this.s.overwrite(node.openEnd, node.closeStart, code);
    }
  }

  // ---------- indentation helpers: edits match the file's existing style ----------

  private unitCache: string | null = null;
  /** The file's indent unit: tabs, or the smallest non-zero space indent. */
  private unit(): string {
    if (this.unitCache) return this.unitCache;
    if (/^\t/m.test(this.source)) return (this.unitCache = "\t");
    let min = Infinity;
    // ` * ` lines of block comments aren't indentation
    for (const m of this.source.matchAll(/^( +)(?!\*)\S/gm)) min = Math.min(min, m[1].length);
    return (this.unitCache = " ".repeat(Number.isFinite(min) && min <= 8 ? min : 2));
  }

  lineIndent(pos: number): string {
    const lineStart = this.source.lastIndexOf("\n", pos - 1) + 1;
    return /^[ \t]*/.exec(this.source.slice(lineStart))![0];
  }

  /** Where a node's real content starts/ends (JSX text includes surrounding whitespace). */
  contentStart(n: CanvasNode) {
    if (n.kind !== "text") return n.start;
    const raw = this.source.slice(n.start, n.end);
    return n.start + (raw.length - raw.trimStart().length);
  }
  contentEnd(n: CanvasNode) {
    if (n.kind !== "text") return n.end;
    return n.start + this.source.slice(n.start, n.end).trimEnd().length;
  }

  childIndent(parent: CanvasNode): string {
    const kid = parent.children.find((c) => c.kind !== "text") ?? parent.children[0];
    if (kid) {
      const pos = this.contentStart(kid);
      const lineStart = this.source.lastIndexOf("\n", pos - 1) + 1;
      if (/^[ \t]*$/.test(this.source.slice(lineStart, pos))) return this.lineIndent(pos);
    }
    return this.lineIndent(parent.start) + this.unit();
  }

  /** Re-indents lines 2..n of a snippet so it sits at `indent`. */
  shift(code: string, indent: string): string {
    const lines = code.trim().split("\n");
    const rest = lines.slice(1).filter((l) => l.trim());
    const base = rest.length ? Math.min(...rest.map((l) => /^[ \t]*/.exec(l)![0].length)) : 0;
    const relative = lines.slice(1).map((l) => (l.trim() ? l.slice(base) : ""));
    // a snippet indented by 2 lands in a 4-space (or tab) file with the file's unit
    const steps = relative.map((l) => /^ */.exec(l)![0].length).filter((n) => n > 0);
    const from = steps.length ? Math.min(...steps) : 0;
    const unit = this.unit();
    const convert = (l: string) => {
      if (!from || unit === " ".repeat(from)) return l;
      const n = /^ */.exec(l)![0].length;
      return unit.repeat(Math.floor(n / from)) + " ".repeat(n % from) + l.slice(n);
    };
    return [lines[0], ...relative.map((l) => (l ? indent + convert(l) : ""))].join("\n");
  }

  private openToClose(node: CanvasNode, inner: string) {
    let end = node.openEnd - 2;
    while (/\s/.test(this.source[end - 1])) end--;
    this.s.overwrite(end, node.openEnd, `>${inner}</${node.name}>`);
  }

  private insertAt(parent: CanvasNode, kids: CanvasNode[], i: number, code: string) {
    const ci = this.childIndent(parent);
    const pi = this.lineIndent(parent.start);
    const body = this.shift(code, ci);
    if (parent.selfClosing) {
      this.openToClose(parent, `\n${ci}${body}\n${pi}`);
    } else if (i < kids.length) {
      this.s.appendRight(this.contentStart(kids[i]), `${body}\n${ci}`);
    } else if (kids.length) {
      this.s.appendLeft(this.contentEnd(kids[kids.length - 1]), `\n${ci}${body}`);
    } else if (parent.openEnd === parent.closeStart) {
      // <X></X>: nothing between the tags to replace
      this.s.appendLeft(parent.openEnd, `\n${ci}${body}\n${pi}`);
    } else if (/^\s*$/.test(this.source.slice(parent.openEnd, parent.closeStart))) {
      this.s.overwrite(parent.openEnd, parent.closeStart, `\n${ci}${body}\n${pi}`);
    } else {
      this.s.appendRight(parent.closeStart, `${body}`);
    }
  }

  insertChild(parent: CanvasNode, index: number | undefined, jsx: string) {
    const kids = parent.children;
    const i = index === undefined || index < 0 || index > kids.length ? kids.length : index;
    this.insertAt(parent, kids, i, jsx);
    this.selectPaths.push([...parent.path, i]);
  }

  /** Removes a node together with its line when it sits alone on it. */
  remove(node: CanvasNode) {
    const start = this.contentStart(node);
    const end = this.contentEnd(node);
    let a = start;
    while (a > 0 && (this.source[a - 1] === " " || this.source[a - 1] === "\t")) a--;
    const restOfLine = /^[ \t]*(\n|$)/.test(this.source.slice(end));
    if (a > 0 && this.source[a - 1] === "\n" && restOfLine) this.s.remove(a - 1, end);
    else this.s.remove(node.start, node.end);
  }

  duplicate(node: CanvasNode) {
    let code = this.source.slice(node.start, node.end);
    if ("frameName" in node) {
      // duplicating a frame: unique name, placed right of everything in its row
      const f = node as CanvasFrame;
      this.usedFrameNames ??= new Set(this.doc.frames.map((x) => x.frameName));
      this.placed ??= this.doc.frames.map((o) => ({ x: o.x, y: o.y, width: o.width, height: o.height ?? 600 }));
      let name = `${f.frameName} copy`;
      for (let n = 2; this.usedFrameNames.has(name); n++) name = `${f.frameName} copy ${n}`;
      this.usedFrameNames.add(name);
      const h = f.height ?? 600;
      const row = this.placed.filter((o) => o.y < f.y + Math.max(h, 1) && o.y + Math.max(o.height, 1) > f.y);
      const right = row.length ? Math.max(...row.map((o) => o.x + o.width)) : f.x + f.width;
      this.placed.push({ x: right + 80, y: f.y, width: f.width, height: h });
      code = rewriteFrameProps(code, { name, x: right + 80 });
    }
    this.s.appendLeft(this.contentEnd(node), `\n${this.lineIndent(node.start)}${code.trim()}`);
    const path = [...node.path];
    path[path.length - 1] += 1;
    this.selectPaths.push(path);
  }

  move(node: CanvasNode, target: CanvasNode, index: number | undefined) {
    if (isInside(target, node)) throw new EditError("Cannot move a node into itself.");
    const raw = this.source.slice(this.contentStart(node), this.contentEnd(node));
    // Mark the moved element so it can be re-selected afterwards.
    const code = node.kind === "component" || node.kind === "element" ? raw.replace(/^<([\w.:-]+)/, "<$1 __tcsel") : raw;
    const kids = target.children.filter((c) => c.id !== node.id);
    const i = index === undefined || index < 0 || index > kids.length ? kids.length : index;
    this.remove(node);
    this.insertAt(target, kids, i, code);
  }

  wrap(nodes: CanvasNode[], open: string, close: string) {
    const sorted = [...nodes].sort((a, b) => a.start - b.start);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];
    if (sorted.some((n) => "frameName" in n)) throw new EditError("Frames can't be wrapped; wrap the layers inside a frame.");
    const parentPath = first.path.slice(0, -1).join(",");
    if (sorted.some((n) => n.path.slice(0, -1).join(",") !== parentPath)) throw new EditError("Nodes to wrap must share the same parent.");
    const indices = sorted.map((n) => n.path[n.path.length - 1]);
    const parent = findByPath(this.doc, first.path.slice(0, -1));
    const between = parent?.children.slice(indices[0], indices[indices.length - 1] + 1) ?? [];
    if (between.some((c) => c.kind !== "text" && !sorted.includes(c))) throw new EditError("Nodes to wrap must be adjacent siblings.");
    const ind = this.lineIndent(this.contentStart(first));
    const inner = ind + this.unit();
    const slice = this.source.slice(this.contentStart(first), this.contentEnd(last));
    this.s.overwrite(this.contentStart(first), this.contentEnd(last), `${open}\n${inner}${this.shift(slice, inner)}\n${ind}${close}`);
    this.selectPaths.push(first.path);
  }

  /** Like wrap, but keeps content that sits on one line on one line: `<p><X>Hi</X></p>`. */
  wrapInline(nodes: CanvasNode[], open: string, close: string) {
    const sorted = [...nodes].sort((a, b) => a.start - b.start);
    const start = this.contentStart(sorted[0]);
    const end = this.contentEnd(sorted[sorted.length - 1]);
    const slice = this.source.slice(start, end);
    if (slice.includes("\n")) return this.wrap(nodes, open, close);
    this.s.overwrite(start, end, `${open}${slice}${close}`);
    this.selectPaths.push(sorted[0].path);
  }

  /** Replaces a wrapper element with its children (re-indented to its place). */
  unwrap(node: CanvasNode) {
    const kids = node.children;
    if (!kids.length) {
      this.remove(node);
      return;
    }
    const inner = this.source.slice(this.contentStart(kids[0]), this.contentEnd(kids[kids.length - 1]));
    this.s.overwrite(this.contentStart(node), this.contentEnd(node), this.shift(inner, this.lineIndent(this.contentStart(node))));
    this.selectPaths.push(node.path);
  }

  replace(node: CanvasNode, jsx: string) {
    this.s.overwrite(this.contentStart(node), this.contentEnd(node), this.shift(jsx, this.lineIndent(this.contentStart(node))));
    this.selectPaths.push(node.path);
  }

  private added = new Set<string>();
  ensureImport(name: string, from: string) {
    if (this.doc.imports.some((i) => i.names.includes(name) || i.defaultName === name)) return;
    if (this.added.has(name)) return;
    this.added.add(name);
    const same = this.doc.imports.find((i) => i.source === from && !i.typeOnly && i.lastSpecifierEnd !== null);
    if (same) {
      this.s.appendLeft(same.lastSpecifierEnd!, `, ${name}`);
      return;
    }
    const last = this.doc.imports[this.doc.imports.length - 1];
    const line = `import { ${name} } from ${JSON.stringify(from)};`;
    if (last) this.s.appendLeft(last.end, `\n${line}`);
    else if (this.doc.prologueEnd) this.s.appendLeft(this.doc.prologueEnd, `\n${line}`);
    else this.prependImport(line);
  }

  /** Adds a whole import statement unless every name it binds is already imported. */
  addImportStatement(statement: string) {
    let names: string[] = [];
    try {
      const ast = parseModule(statement);
      const decl = ast.program.body[0];
      if (decl?.type === "ImportDeclaration") names = decl.specifiers.map((sp) => sp.local.name);
    } catch {
      return;
    }
    const known = new Set([...this.doc.imports.flatMap((i) => [...i.names, ...(i.defaultName ? [i.defaultName] : [])]), ...this.added]);
    if (names.length && names.every((n) => known.has(n))) return;
    for (const n of names) this.added.add(n);
    const last = this.doc.imports[this.doc.imports.length - 1];
    if (last) this.s.appendLeft(last.end, `\n${statement}`);
    else if (this.doc.prologueEnd) this.s.appendLeft(this.doc.prologueEnd, `\n${statement}`);
    else this.prependImport(statement);
  }

  private importsPrepended = false;
  /** First imports of a file: in order, with a blank line before the code. */
  private prependImport(line: string) {
    if (!this.importsPrepended) {
      this.importsPrepended = true;
      this.s.prependRight(0, "\n");
    }
    this.s.appendLeft(0, `${line}\n`);
  }

  insertFrame(code: string) {
    const canvas = this.doc.canvasNode;
    if (!canvas) throw new EditError("No <Canvas> element to add a frame to.");
    this.insertAt(canvas, canvas.children, canvas.children.length, code);
    this.selectPaths.push([this.doc.frames.length]);
  }

  result(): string {
    return this.s.toString();
  }
}

function isInside(target: CanvasNode, node: CanvasNode) {
  return target.start >= node.start && target.end <= node.end;
}

/** Rewrites literal props on the first opening tag of `code` (used for frame duplication). */
export function rewriteFrameProps(code: string, props: Record<string, Literal>): string {
  const wrapped = `(${code})`;
  const ast = parseModule(wrapped);
  let open: import("@babel/types").JSXOpeningElement | null = null;
  walk(ast, (n) => {
    if (open) return false;
    if (n.type === "JSXOpeningElement") open = n;
  });
  if (!open) return code;
  const o = open as import("@babel/types").JSXOpeningElement;
  const s = new MagicString(wrapped);
  for (const [name, value] of Object.entries(props)) {
    const attr = o.attributes.find((a) => a.type === "JSXAttribute" && a.name.name === name);
    if (attr) {
      if (value === null) s.remove(attr.start! - 1, attr.end!);
      else s.overwrite(attr.start!, attr.end!, attrCode(name, value));
    } else if (value !== null) s.appendLeft(o.name.end!, ` ${attrCode(name, value)}`);
  }
  return s.toString().slice(1, -1);
}

/** Capitalized JSX tag names used in a snippet (to auto-import). */
export function componentNamesIn(jsx: string): string[] {
  const names = new Set<string>();
  const ast = parseJsx(jsx);
  walk(ast, (n) => {
    if (n.type === "JSXOpeningElement") {
      const name = jsxName(n.name);
      // `<Foo>` and member tags like `<motion.div>` need a binding; `<div>` doesn't
      if (/^[A-Z]/.test(name) || name.includes(".")) names.add(name.split(".")[0]);
    }
  });
  return [...names];
}

export function parseJsx(jsx: string) {
  try {
    return parseModule(`<>${jsx}</>`);
  } catch (err) {
    throw new EditError(`Invalid JSX: ${(err as Error).message.replace(/\(\d+:\d+\)$/, "")}`);
  }
}

export function frameCode(opts: { name: string; x: number; y: number; width: number; height?: number | null; theme?: string | null; device?: string | null; page?: string; from?: string; component?: string; body?: string }): string {
  const attrs = [attrCode("name", opts.name), attrCode("x", Math.round(opts.x)), attrCode("y", Math.round(opts.y)), attrCode("width", Math.round(opts.width))];
  if (opts.height) attrs.push(attrCode("height", Math.round(opts.height)));
  if (opts.theme) attrs.push(attrCode("theme", opts.theme));
  if (opts.device) attrs.push(attrCode("device", opts.device));
  if (opts.page) attrs.push(attrCode("page", opts.page));
  if (opts.from) attrs.push(attrCode("from", opts.from));
  if (opts.component) attrs.push(attrCode("component", opts.component));
  const body = opts.body ?? `<div className="flex flex-col gap-3 p-6"></div>`;
  return `<Frame ${attrs.join(" ")}>\n${indentBlock(body)}\n</Frame>`;
}

/** Re-locate a node in a freshly parsed doc by path, falling back to a source match. */
export function relocate(source: string, path: number[] | null, needle?: string | null) {
  const doc = parseCanvas("", "", source);
  if (path) {
    const byPath = findByPath(doc, path);
    if (byPath) return byPath.id;
  }
  if (needle) {
    const at = source.indexOf(needle.trim());
    if (at >= 0) {
      let best: CanvasNode | null = null;
      for (const f of doc.frames) {
        const stack: CanvasNode[] = [f];
        while (stack.length) {
          const n = stack.pop()!;
          if (n.start === at) best = n;
          stack.push(...n.children);
        }
      }
      if (best) return best.id;
    }
  }
  return null;
}

export function indentBlock(code: string, unit = "  ") {
  return code
    .split("\n")
    .map((l) => (l.trim() ? unit + l : l))
    .join("\n");
}
