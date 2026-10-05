import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { TruecanvasConfig } from "./config.js";
import { Catalog, importSpecifier } from "./catalog.js";
import { CanvasEditor, EditError, attrCode, componentNamesIn, frameCode, indentBlock, parseJsx, textCode, type Literal } from "./edit.js";
import { parseModule } from "./ast.js";
import { findFrame, findNode, parseCanvas } from "./parse.js";
import { applyPlan, dedent, explorationBody, linkedFrameBody, pruneImports, resolveLinks, splitComponentRef } from "./link.js";
import { fileOfId, parseModuleDoc, parseSourceDoc, parseTargetDoc } from "./source.js";
import { ensureMotionComponents, motionFiles, type MotionFiles } from "./motion.js";
import { componentFile, componentName, importsFor, newComponentPath, starterJsx } from "./components.js";
import { DEVICES, findDevice } from "./devices.js";
import { listRoutes, routeFrame } from "./routes.js";
import { Comments, type CommentAuthor } from "./comments.js";
import { Git } from "./git.js";
import { CANVAS_SUFFIX, STARTER_CANVAS, canvasFiles, canvasNameOf, canvasPath, syncRoute } from "./scaffold.js";
import type { CanvasDoc, CanvasNode, ComponentSpec } from "./types.js";

const require = createRequire(import.meta.url);

export type Actor = { kind: "user" } | { kind: "agent"; name: string } | { kind: "file" };

export type Command =
  | { op: "set_props"; canvas: string; id: string; props: Record<string, Literal> }
  | { op: "set_text"; canvas: string; id: string; text: string }
  | { op: "set_class"; canvas: string; id: string; className: string }
  | { op: "insert_jsx"; canvas: string; parent: string; index?: number; jsx: string }
  | { op: "insert_component"; canvas: string; parent: string; index?: number; component: string; props?: Record<string, Literal>; text?: string }
  | { op: "replace"; canvas: string; id: string; jsx: string }
  | { op: "duplicate"; canvas: string; ids: string[] }
  | { op: "delete"; canvas: string; ids: string[] }
  | { op: "move"; canvas: string; id: string; parent: string; index?: number }
  | { op: "reorder"; canvas: string; id: string; delta: number }
  | { op: "wrap"; canvas: string; ids: string[]; className?: string }
  | { op: "create_frame"; canvas: string; name?: string; x?: number; y?: number; width?: number; height?: number | null; theme?: "light" | "dark" | null; device?: string | null; jsx?: string }
  | { op: "update_frame"; canvas: string; frame: string; name?: string; x?: number; y?: number; width?: number; height?: number | null; theme?: "light" | "dark" | null; device?: string | null }
  | { op: "add_background"; canvas: string; parent: string; component: string; preset?: string }
  | { op: "apply_preset"; canvas: string; id: string; preset: string }
  | { op: "import_route"; canvas: string; route: string; name?: string; width?: number; x?: number; y?: number; copy?: boolean }
  | { op: "explore_copy"; canvas: string; frame: string; name?: string }
  | { op: "apply_to_page"; canvas: string; frame: string }
  | { op: "add_animation"; canvas: string; id: string; kind: "reveal" | "text"; effect?: string; delay?: number; duration?: number; stagger?: number; once?: boolean }
  | { op: "remove_animation"; canvas: string; id: string; kind: "reveal" | "text" }
  | { op: "create_component"; canvas: string; name: string; from?: string; parent?: string; index?: number }
  | { op: "add_component_frame"; canvas: string; component: string; x?: number; y?: number; width?: number }
  | { op: "create_variants"; canvas: string; component: string; prop: string; props?: Record<string, Literal>; x?: number; y?: number };

export interface HistoryEntry {
  id: number;
  canvas: string;
  label: string;
  actor: Actor;
  at: number;
  before: string;
  after: string;
  ids: string[];
  /** project-relative file this entry edited, when it isn't the canvas (a linked page or layout) */
  file?: string;
  /** frames the change touched (for "what changed" in the Git panel) */
  frames?: string[];
}

export type WorkspaceEvent =
  | { type: "doc"; canvas: string; doc: CanvasDoc }
  | { type: "canvases"; canvases: string[] }
  | { type: "catalog" }
  | { type: "change"; entry: PublicEntry; ids: string[] }
  | { type: "history"; canvas: string; undo: number; redo: number }
  | { type: "focus"; canvas: string; ids: string[]; actor: string }
  | { type: "agents"; agents: AgentInfo[] }
  | { type: "presence"; presence: Presence }
  | { type: "canvas-renamed"; from: string; to: string }
  | { type: "comments"; canvas: string }
  | { type: "motion"; canvas: string; frame: string; action: "play" | "replay" | "stop" }
  | { type: "git" };

/** What an agent is doing right now, for live cursors in the editor. */
export interface Presence {
  session: string;
  name: string;
  canvas: string;
  action: "reading" | "editing" | "looking";
  label: string;
  /** node or frame ids the agent is on */
  ids: string[];
  /** frame name when the target is a whole frame */
  frame: string | null;
  at: number;
}

export type PublicEntry = Omit<HistoryEntry, "before" | "after">;
export interface AgentInfo {
  session: string;
  name: string;
  since: number;
  lastSeen: number;
}

const MARK = "__tcsel";

class ConflictError extends EditError {
  constructor(
    message: string,
    readonly file?: string,
  ) {
    super(message);
  }
}


export class Workspace {
  readonly catalog: Catalog;
  private sources = new Map<string, string>();
  private undoStacks = new Map<string, HistoryEntry[]>();
  private redoStacks = new Map<string, HistoryEntry[]>();
  readonly feed: HistoryEntry[] = [];
  private seq = 0;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(e: WorkspaceEvent) => void>();
  selection: { canvas: string | null; ids: string[] } = { canvas: null, ids: [] };
  agents = new Map<string, AgentInfo>();

  readonly comments: Comments;
  readonly git: Git;

  constructor(readonly config: TruecanvasConfig) {
    this.catalog = new Catalog(config.root, config.components, config.libraries);
    this.comments = new Comments(config);
    this.git = new Git(config.root);
    for (const c of this.canvases()) this.sources.set(c, fs.readFileSync(this.file(c), "utf8"));
  }

  on(fn: (e: WorkspaceEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  emit(e: WorkspaceEvent) {
    for (const fn of this.listeners) fn(e);
  }

  // ---------- canvases ----------

  canvases(): string[] {
    return canvasFiles(this.config).map(canvasNameOf);
  }

  file(canvas: string) {
    return canvasPath(this.config, canvas);
  }

  relFile(canvas: string) {
    return path.relative(this.config.root, this.file(canvas));
  }

  read(canvas: string): string {
    const file = this.file(canvas);
    if (!fs.existsSync(file)) throw new EditError(`Canvas "${canvas}" does not exist. Canvases: ${this.canvases().join(", ") || "none"}`);
    const src = fs.readFileSync(file, "utf8");
    // `sources` tracks the last version we know about, so external edits can be detected
    if (!this.sources.has(canvas)) this.sources.set(canvas, src);
    return src;
  }

  doc(canvas: string): CanvasDoc {
    return this.docFrom(canvas, this.read(canvas));
  }

  /** A canvas doc with linked frames resolved to their page's layers. */
  docFrom(canvas: string, source: string): CanvasDoc {
    return resolveLinks(this.config, parseCanvas(canvas, this.relFile(canvas), source));
  }

  /** Where a node's code lives: the canvas, or a linked page/layout file. */
  nodeSource(canvas: string, id: string) {
    const hit = findNode(this.doc(canvas), id);
    if (!hit) return null;
    const rel = fileOfId(id) ?? this.relFile(canvas);
    const abs = path.join(this.config.root, rel);
    return { node: hit.node, rel, abs, source: fs.readFileSync(abs, "utf8") };
  }

  /** Page and layout files shown by linked frames, across all canvases (the Git panel counts them as design files). */
  linkedFiles(): string[] {
    const out = new Set<string>();
    for (const c of this.canvases()) {
      try {
        for (const f of this.doc(c).frames) for (const file of f.link?.files ?? []) out.add(file);
      } catch {
        /* unreadable canvas */
      }
    }
    return [...out];
  }

  /**
   * Files that belong with design commits besides the canvas folder: linked
   * pages and layouts, and the motion components animations import.
   */
  designFiles(): string[] {
    const m = motionFiles(this.config);
    return [...this.linkedFiles(), ...[m.reveal, m.text].filter((f) => fs.existsSync(path.join(this.config.root, f)))];
  }

  /** Canvases with a linked frame showing this page or layout file. */
  private canvasesLinking(rel: string): string[] {
    return this.canvases().filter((c) => {
      try {
        return this.doc(c).frames.some((f) => f.page === rel || f.link?.files.includes(rel));
      } catch {
        return false;
      }
    });
  }

  /** Called by the app-dir watcher: a page or layout changed (in a code editor, or by git). */
  linkedFileChanged(rel: string) {
    let next: string;
    try {
      next = fs.readFileSync(path.join(this.config.root, rel), "utf8");
    } catch {
      next = "";
    }
    const key = `file:${rel}`;
    if (this.sources.get(key) === next) return;
    this.sources.set(key, next);
    for (const c of this.canvasesLinking(rel)) this.emit({ type: "doc", canvas: c, doc: this.doc(c) });
  }

  createCanvas(name: string, actor: Actor, content = STARTER_CANVAS): string {
    const file = canvasPath(this.config, name);
    if (fs.existsSync(file)) throw new EditError(`Canvas "${name}" already exists.`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    this.sources.set(name, content);
    this.canvasesChanged();
    this.record(name, `Created canvas ${name}`, actor, "", content, []);
    return name;
  }

  // ---------- comments ----------

  async userAuthor(): Promise<CommentAuthor> {
    const s = await this.git.status().catch(() => null);
    return { name: s?.user ?? (process.env.USER || "You"), kind: "user" };
  }

  commentsChanged(canvas: string) {
    this.emit({ type: "comments", canvas });
  }

  /** Pages panel: each canvas with its frame count. */
  canvasInfos(): { name: string; frames: number }[] {
    return this.canvases().map((name) => {
      try {
        return { name, frames: this.doc(name).frames.length };
      } catch {
        return { name, frames: 0 };
      }
    });
  }

  private uniqueCanvasName(base: string) {
    const taken = new Set(this.canvases());
    if (!taken.has(base)) return base;
    for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
  }

  private canvasesChanged() {
    syncRoute(this.config);
    this.emit({ type: "canvases", canvases: this.canvases() });
  }

  renameCanvas(from: string, to: string) {
    const src = this.file(from);
    if (!fs.existsSync(src)) throw new EditError(`Canvas "${from}" does not exist.`);
    const dest = canvasPath(this.config, to);
    if (fs.existsSync(dest)) throw new EditError(`A canvas named "${to}" already exists.`);
    fs.renameSync(src, dest);
    this.comments.renameCanvas(from, to);
    // history and caches follow the file
    for (const map of [this.sources, this.undoStacks, this.redoStacks] as Map<string, unknown>[]) {
      if (map.has(from)) {
        map.set(to, map.get(from));
        map.delete(from);
      }
    }
    for (const e of this.feed) if (e.canvas === from) e.canvas = to;
    if (this.selection.canvas === from) this.selection = { ...this.selection, canvas: to };
    this.canvasesChanged();
    this.emit({ type: "canvas-renamed", from, to });
    return to;
  }

  duplicateCanvas(name: string) {
    const source = this.read(name);
    const copy = this.uniqueCanvasName(`${name}-copy`);
    fs.writeFileSync(canvasPath(this.config, copy), source);
    this.sources.set(copy, source);
    this.canvasesChanged();
    return copy;
  }

  /** Deleted pages are kept in memory for this session so they can be restored. */
  private trash = new Map<string, string>();

  deleteCanvas(name: string) {
    const file = this.file(name);
    if (!fs.existsSync(file)) throw new EditError(`Canvas "${name}" does not exist.`);
    this.trash.set(name, fs.readFileSync(file, "utf8"));
    fs.unlinkSync(file);
    this.sources.delete(name);
    this.canvasesChanged();
  }

  restoreCanvas(name: string) {
    const source = this.trash.get(name);
    if (source === undefined) throw new EditError(`Nothing to restore for "${name}".`);
    const target = this.uniqueCanvasName(name);
    fs.writeFileSync(canvasPath(this.config, target), source);
    this.sources.set(target, source);
    this.trash.delete(name);
    this.canvasesChanged();
    return target;
  }

  /** Called by the file watcher. Edits made in a code editor become undoable history too. */
  externalChange(fileName: string) {
    if (!fileName.endsWith(CANVAS_SUFFIX)) return;
    const canvas = canvasNameOf(fileName);
    const file = this.file(canvas);
    if (!fs.existsSync(file)) {
      this.sources.delete(canvas);
      syncRoute(this.config);
      this.emit({ type: "canvases", canvases: this.canvases() });
      return;
    }
    const prev = this.sources.get(canvas);
    const next = fs.readFileSync(file, "utf8");
    if (prev === next) return;
    this.sources.set(canvas, next);
    if (prev === undefined) {
      syncRoute(this.config);
      this.emit({ type: "canvases", canvases: this.canvases() });
    } else {
      this.record(canvas, "Edited in code", { kind: "file" }, prev, next, []);
    }
    this.emit({ type: "doc", canvas, doc: this.docFrom(canvas, next) });
  }

  // ---------- commands ----------

  run(cmd: Command, actor: Actor): Promise<{ doc: CanvasDoc; ids: string[]; label: string }> {
    const job = this.queue.then(async () => {
      try {
        return await this.exec(cmd, actor);
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
        // pick up the external edit first so it stays undoable, then retry once
        if (err.file) this.linkedFileChanged(err.file);
        else this.externalChange(path.basename(this.file(cmd.canvas)));
        return this.exec(cmd, actor);
      }
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  private async exec(cmd: Command, actor: Actor) {
    cmd = { ...cmd };
    // main components get their own page, made on first use
    if (cmd.op === "add_component_frame" && !fs.existsSync(this.file(cmd.canvas))) this.createCanvas(cmd.canvas, actor, COMPONENTS_CANVAS);
    const canvasSource = this.read(cmd.canvas);
    const canvasDoc = parseCanvas(cmd.canvas, this.relFile(cmd.canvas), canvasSource);
    if (canvasDoc.error) throw new EditError(`The canvas file does not parse: ${canvasDoc.error}`);
    const view = resolveLinks(this.config, canvasDoc);
    cmd = this.routeLinked(cmd, view);

    // Which file the edit writes: the canvas, or the page/layout a linked layer comes from.
    let target = this.targetOf(cmd);
    if (cmd.op === "explore_copy") {
      // the canvas' own frame: its children are the layout/page wrappers
      const frame = findFrame(canvasDoc, cmd.frame);
      if (!frame) throw new EditError(`Frame "${cmd.frame}" not found.`);
      const body = explorationBody(this.config, frame, this.relFile(cmd.canvas));
      this.pending = { kind: "explore", frame, imports: body.imports, jsx: await this.formatSnippet(body.jsx) };
    }
    if (cmd.op === "apply_to_page") {
      const frame = findFrame(canvasDoc, cmd.frame);
      if (!frame) throw new EditError(`Frame "${cmd.frame}" not found.`);
      const plan = applyPlan(this.config, canvasSource, canvasDoc, frame, this.relFile(cmd.canvas));
      target = plan.page;
      this.pending = { kind: "apply", frame, ...plan };
    }
    const rel = target ?? this.relFile(cmd.canvas);
    const file = path.join(this.config.root, rel);
    const before = target ? fs.readFileSync(file, "utf8") : canvasSource;
    const parse = (src: string): CanvasDoc | null => (target ? parseTargetDoc(target, src) : parseCanvas(cmd.canvas, rel, src));
    const doc = parse(before);
    if (!doc) throw new EditError(`${rel} has data or logic in its component now, so it can't be edited from the canvas. Explore a copy instead.`);

    if ((cmd.op === "insert_jsx" || cmd.op === "replace" || cmd.op === "create_frame") && cmd.jsx) {
      cmd = { ...cmd, jsx: await this.formatSnippet(cmd.jsx) };
    }
    if (cmd.op === "import_route") {
      // resolve the page up front so its JSX can be pretty-printed like any snippet
      const routes = listRoutes(this.config);
      const r = routes.find((x) => x.route === cmd.route || x.file === (cmd as { route: string }).route);
      if (!r) throw new EditError(`No page "${cmd.route}". Pages: ${routes.map((x) => x.route).join(", ") || "none"}`);
      if (cmd.copy) {
        const built = routeFrame(this.config, r.file, this.relFile(cmd.canvas));
        this.pending = { kind: "route", route: r.route, page: null, imports: built.imports, mode: built.mode, jsx: await this.formatSnippet(built.jsx) };
      } else {
        const built = linkedFrameBody(this.config, canvasDoc, this.relFile(cmd.canvas), r.file);
        this.pending = { kind: "route", route: r.route, page: r.file, imports: built.imports, mode: "linked", jsx: built.jsx };
      }
    }
    if (cmd.op === "add_animation") {
      // first animation in the project: add the Reveal/TextAnimate components
      const files = ensureMotionComponents(this.config);
      if (files.created) this.catalog.invalidate();
      this.motion = files;
    }
    let newComponent: { rel: string; content: string } | null = null;
    let movedNames = new Set<string>();
    if (cmd.op === "create_component") {
      const name = componentName(cmd.name);
      if (!name) throw new EditError(`"${cmd.name}" can't be a component name. Use letters and digits, like PricingCard.`);
      await this.catalog.load().catch(() => []);
      if (this.catalog.get(name) || doc.declared.includes(name) || doc.imports.some((i) => i.names.includes(name) || i.defaultName === name)) throw new EditError(`There's already a ${name}. Pick another name.`);
      const fileRel = newComponentPath(this.config, name);
      let jsx = starterJsx(name);
      let imports: string[] = [];
      if (cmd.from) {
        const hit = findNode(doc, cmd.from);
        if (!hit) throw new EditError(`Node ${cmd.from} not found.`);
        if (hit.node === hit.frame) throw new EditError("Select layers inside the frame to turn them into a component.");
        if (hit.node.kind !== "element" && hit.node.kind !== "component" && hit.node.kind !== "fragment") throw new EditError("Select an element (not text) to turn it into a component.");
        jsx = dedent(before.slice(hit.node.start, hit.node.end));
        imports = importsFor(this.config, jsx, before, doc, rel, fileRel);
        movedNames = new Set(componentNamesIn(jsx));
      }
      const abs = path.join(this.config.root, fileRel);
      newComponent = { rel: fileRel, content: await this.format(componentFile(name, jsx, imports), abs).catch(() => componentFile(name, jsx, imports)) };
      this.pending = { kind: "component", name, file: fileRel };
    }
    await this.catalog.load().catch(() => []);
    const ed = new CanvasEditor(before, doc);
    const renamedFrame = cmd.op === "update_frame" && cmd.name !== undefined ? findFrame(doc, cmd.frame) : null;
    const usedBefore = cmd.op === "apply_to_page" ? new Set(componentNamesIn(before.slice(doc.frames[0].children[0].start, doc.frames[0].children[0].end))) : null;
    const label = this.apply(ed, cmd, rel);
    // Respect the file's style: only run Prettier if the file was already Prettier-clean.
    const pretty = await this.isPrettierClean(before, file);
    const finish = async (code: string) => (pretty ? this.format(code, file) : validate(code));
    let result = ed.result();
    if (usedBefore) result = pruneImports(result, usedBefore);
    if (cmd.op === "remove_animation") result = pruneImports(result, new Set(["Reveal", "TextAnimate"]));
    // layers moved into a new component take their imports along: drop the ones this file no longer uses
    if (cmd.op === "create_component" && cmd.from && movedNames.size) result = pruneImports(result, movedNames);
    let after = await finish(result);

    // Resolve what to select in the new source.
    let ids: string[] = [];
    const reparse = (src: string) => {
      const d = parse(src);
      if (!d) throw new EditError(`That edit would put logic into ${path.basename(rel)}. Only plain JSX can be edited from the canvas.`);
      return d;
    };
    if (after.includes(MARK)) {
      const marked = reparse(after);
      const paths: number[][] = [];
      for (const f of marked.frames) {
        const stack: CanvasNode[] = [f];
        while (stack.length) {
          const n = stack.pop()!;
          if (n.props[MARK]) paths.push(n.path);
          stack.push(...n.children);
        }
      }
      after = await finish(after.replace(new RegExp(`\\s*${MARK}(?=[\\s/>])`, "g"), ""));
      const clean = reparse(after);
      ids = paths.map((p) => pathId(clean, p)).filter(Boolean) as string[];
    } else {
      const clean = reparse(after);
      const paths = ed.selectPaths.length ? ed.selectPaths : touchedPaths(doc, cmd);
      ids = paths.map((p) => pathId(clean, p)).filter(Boolean) as string[];
    }
    // "Apply to page" selects the frame it applied
    if (cmd.op === "apply_to_page") ids = [findFrame(canvasDoc, cmd.frame)!.id];

    if (after === before) return { doc: target ? this.doc(cmd.canvas) : view, ids, label };
    // Someone saved the file while we were formatting: don't overwrite their change.
    if (fs.readFileSync(file, "utf8") !== before) throw new ConflictError(`${path.basename(rel)} changed during the edit.`, target ?? undefined);
    if (newComponent) {
      fs.mkdirSync(path.dirname(path.join(this.config.root, newComponent.rel)), { recursive: true });
      fs.writeFileSync(path.join(this.config.root, newComponent.rel), newComponent.content, { flag: "wx" });
      this.catalog.invalidate();
      this.emit({ type: "catalog" });
    }
    if (target) this.sources.set(`file:${target}`, after);
    else this.sources.set(cmd.canvas, after);
    fs.writeFileSync(file, after);
    const newDoc = this.doc(cmd.canvas);
    this.record(cmd.canvas, label, actor, before, after, ids, target ?? undefined, touchedFrames(cmd, ids, view, newDoc));
    if (renamedFrame) {
      const now = newDoc.frames[renamedFrame.path[0]];
      if (now && now.frameName !== renamedFrame.frameName) {
        this.comments.renameFrame(cmd.canvas, renamedFrame.frameName, now.frameName);
        this.emit({ type: "comments", canvas: cmd.canvas });
      }
    }
    this.emit({ type: "doc", canvas: cmd.canvas, doc: newDoc });
    // other pages showing the same file follow along
    if (target) for (const c of this.canvasesLinking(target)) if (c !== cmd.canvas) this.emit({ type: "doc", canvas: c, doc: this.doc(c) });
    return { doc: newDoc, ids, label };
  }

  /**
   * Linked frames: a frame passed as a parent means the page's root element,
   * and view-only pages refuse edits on their layers.
   */
  private routeLinked(cmd: Command, view: CanvasDoc): Command {
    const viewOnly = (frame: { frameName: string; link: { reason?: string } | null }) =>
      new EditError(`"${frame.frameName}" is view only: ${frame.link?.reason ?? "its page can't be edited from the canvas."}`);
    if ("parent" in cmd && cmd.parent && !fileOfId(cmd.parent)) {
      const f = findFrame(view, cmd.parent);
      if (f?.link) {
        if (!f.link.editable) throw viewOnly(f);
        const src = fs.readFileSync(path.join(this.config.root, f.link.page), "utf8");
        if (f.link.kind === "component") {
          const own = parseModuleDoc(f.link.page, src)?.frames.find((x) => x.frameName === f.link!.route);
          if (!own) throw viewOnly(f);
          cmd = { ...cmd, parent: own.children[0].id } as Command;
        } else {
          const pageDoc = parseSourceDoc(f.link.page, src, false);
          if (!pageDoc) throw viewOnly(f);
          cmd = { ...cmd, parent: pageDoc.frames[0].children[0].id } as Command;
        }
      }
    }
    const refs = nodeRefs(cmd);
    for (const ref of refs) {
      if (fileOfId(ref)) continue;
      const hit = findNode(view, ref);
      if (hit && hit.frame.link && hit.node !== hit.frame) throw viewOnly(hit.frame);
    }
    return cmd;
  }

  /** The page/layout file the command's layers live in, or null for the canvas. */
  private targetOf(cmd: Command): string | null {
    const refs = nodeRefs(cmd);
    const files = new Set(refs.map(fileOfId));
    if (files.size > 1) {
      const names = [...files].map((f) => (f ? path.basename(f) : "the canvas"));
      throw new EditError(`These layers live in different files (${names.join(", ")}). Edit them one file at a time.`);
    }
    return [...files][0] ?? null;
  }

  private apply(ed: CanvasEditor, cmd: Command, rel: string): string {
    const doc = ed.doc;
    // the root of a page or layout file can't be removed or moved: the component must return something
    const guard = (node: CanvasNode, verb: string) => {
      if (doc.canvasNode) return;
      if (node.path.length <= 2) throw new EditError(`Can't ${verb} the root element of ${path.basename(rel)}.`);
      // a layout's {children} is where the page renders; in a component it's movable content
      if (node.kind === "expression" && node.name.trim() === "children" && /^layout\.[jt]sx?$/.test(path.basename(rel))) throw new EditError(`Can't ${verb} the {children} slot of ${path.basename(rel)}: that's where the page renders.`);
    };
    // in page and component files, a prop computed in code stays code: don't replace it with a literal
    const literalOnly = (node: CanvasNode, key: string) => {
      const v = node.props[key];
      if (!doc.canvasNode && v?.kind === "expression") throw new EditError(`${key} on ${node.name} is computed in code ({${short(v.code, 50)}}). Edit it in ${path.basename(rel)}, or ask your agent.`);
    };
    switch (cmd.op) {
      case "set_props": {
        const { node } = ed.node(cmd.id);
        for (const k of Object.keys(cmd.props)) literalOnly(node, k);
        for (const [k, v] of Object.entries(cmd.props)) ed.setProp(node, k, v);
        const entries = Object.entries(cmd.props);
        // "Set variant to primary on Button": readable in history and in pull requests
        if (entries.length === 1) {
          const [k, v] = entries[0];
          return v === null ? `Removed ${k} from ${node.name}` : `Set ${k} to ${short(JSON.stringify(v).replace(/^"|"$/g, ""))} on ${node.name}`;
        }
        return `Set ${entries.map(([k]) => k).join(", ")} on ${node.name}`;
      }
      case "set_text": {
        const { node, parent } = ed.node(cmd.id);
        ed.setText(node, cmd.text);
        const owner = node.kind === "text" ? parent?.name : node.name;
        return `Changed ${owner && !("frameName" in (parent ?? {})) ? `${owner} ` : ""}text to “${short(cmd.text)}”`;
      }
      case "set_class": {
        const { node } = ed.node(cmd.id);
        const next = cmd.className.trim() ? cmd.className.trim().replace(/\s+/g, " ") : null;
        literalOnly(node, "className");
        ed.setProp(node, "className", next);
        const old = node.props.className?.kind === "string" ? node.props.className.value.split(/\s+/).filter(Boolean) : [];
        const now = next?.split(" ") ?? [];
        const added = now.filter((c) => !old.includes(c));
        const removed = old.filter((c) => !now.includes(c));
        const diff = [...added.map((c) => `+${short(c, 28)}`), ...removed.map((c) => `-${short(c, 28)}`)];
        return diff.length ? `Restyled ${node.name} (${diff.slice(0, 3).join(" ")}${diff.length > 3 ? ` and ${diff.length - 3} more` : ""})` : `Restyled ${node.name}`;
      }
      case "insert_jsx": {
        const parent = ed.container(cmd.parent);
        parseJsx(cmd.jsx);
        this.autoImport(ed, rel, cmd.jsx);
        ed.insertChild(parent, cmd.index, cmd.jsx.trim());
        const names = componentNamesIn(cmd.jsx);
        return `Inserted ${names[0] ?? "element"}${names.length > 1 ? ` +${names.length - 1}` : ""}`;
      }
      case "insert_component": {
        const parent = ed.container(cmd.parent);
        const spec = this.catalog.get(cmd.component);
        if (!spec) throw new EditError(`Unknown component "${cmd.component}". Use list_components.`);
        const jsx = componentJsx(spec, cmd.props, cmd.text);
        ed.ensureImport(spec.name, importSpecifier(this.config.root, rel, spec.file));
        ed.insertChild(parent, cmd.index, jsx);
        return `Inserted ${spec.name}`;
      }
      case "replace": {
        const { node } = ed.node(cmd.id);
        parseJsx(cmd.jsx);
        this.autoImport(ed, rel, cmd.jsx);
        ed.replace(node, cmd.jsx.trim());
        return `Replaced ${node.name}`;
      }
      case "duplicate": {
        const nodes = cmd.ids.map((id) => ed.node(id));
        for (const { node } of nodes) guard(node, "duplicate");
        for (const { node } of nodes) ed.duplicate(node);
        return nodes.length === 1 ? `Duplicated ${nodes[0].node.kind === "component" && "frameName" in nodes[0].node ? "frame" : nodes[0].node.name}` : `Duplicated ${nodes.length} layers`;
      }
      case "delete": {
        const nodes = cmd.ids.map((id) => ed.node(id).node);
        // drop nodes nested in other deleted nodes
        const roots = nodes.filter((n) => !nodes.some((o) => o !== n && n.start >= o.start && n.end <= o.end));
        for (const n of roots) guard(n, "delete");
        for (const n of roots) ed.remove(n);
        return roots.length === 1 ? `Deleted ${"frameName" in roots[0] ? `frame ${(roots[0] as { frameName: string }).frameName}` : roots[0].name}` : `Deleted ${roots.length} layers`;
      }
      case "move": {
        const { node } = ed.node(cmd.id);
        guard(node, "move");
        const target = ed.container(cmd.parent);
        ed.move(node, target, cmd.index);
        return `Moved ${node.name}`;
      }
      case "reorder": {
        const { node, parent } = ed.node(cmd.id);
        if (!parent) throw new EditError("Frames are positioned with x/y, not reordered.");
        guard(node, "move");
        const siblings = parent.children;
        const i = siblings.findIndex((c) => c.id === node.id);
        const j = Math.max(0, Math.min(siblings.length - 1, i + cmd.delta));
        if (i === j) return `Moved ${node.name}`;
        ed.move(node, parent, j);
        return `Moved ${node.name} ${cmd.delta < 0 ? "up" : "down"}`;
      }
      case "wrap": {
        const nodes = cmd.ids.map((id) => ed.node(id).node);
        for (const n of nodes) guard(n, "wrap");
        const cls = cmd.className ?? "flex flex-col gap-2";
        ed.wrap(nodes, `<div className="${cls}">`, "</div>");
        return nodes.length === 1 ? `Wrapped ${nodes[0].name} in auto layout` : `Wrapped ${nodes.length} layers in auto layout`;
      }
      case "create_frame": {
        const device = findDevice(cmd.device);
        if (cmd.device && !device) throw new EditError(`Unknown device "${cmd.device}". Devices: ${DEVICES.map((d) => d.id).join(", ")}`);
        const name = uniqueFrameName(doc, cmd.name ?? device?.name ?? "Frame");
        const right = doc.frames.reduce((m, f) => Math.max(m, f.x + f.width), -80);
        const top = doc.frames.length ? Math.min(...doc.frames.map((f) => f.y)) : 0;
        if (cmd.jsx) {
          parseJsx(cmd.jsx);
          this.autoImport(ed, rel, cmd.jsx);
        }
        ed.insertFrame(
          frameCode({
            name,
            x: cmd.x ?? right + 80,
            y: cmd.y ?? top,
            width: cmd.width ?? device?.width ?? 1024,
            height: cmd.height !== undefined ? cmd.height : (device?.height ?? null),
            theme: cmd.theme ?? null,
            device: device?.id ?? null,
            body: cmd.jsx?.trim(),
          }),
        );
        return `Created frame ${name}`;
      }
      case "update_frame": {
        const f = ed.frame(cmd.frame);
        const changes: string[] = [];
        if (cmd.name !== undefined) {
          ed.setProp(f, "name", uniqueFrameName(doc, cmd.name, f.frameName));
          changes.push("name");
        }
        for (const k of ["x", "y", "width"] as const) {
          if (cmd[k] !== undefined) {
            ed.setProp(f, k, Math.round(cmd[k]!));
            changes.push(k);
          }
        }
        if (cmd.height !== undefined) {
          ed.setProp(f, "height", cmd.height === null ? null : Math.round(cmd.height));
          changes.push("height");
        }
        if (cmd.theme !== undefined) {
          ed.setProp(f, "theme", cmd.theme);
          changes.push("theme");
        }
        if (cmd.device !== undefined) {
          const device = findDevice(cmd.device);
          if (cmd.device && !device) throw new EditError(`Unknown device "${cmd.device}".`);
          ed.setProp(f, "device", device?.id ?? null);
          // picking a device sets its size unless the call sets one explicitly
          if (device && cmd.width === undefined) ed.setProp(f, "width", device.width);
          if (device && cmd.height === undefined) ed.setProp(f, "height", device.height);
          changes.push("device");
        }
        ed.selectPaths.push(f.path);
        if (changes.length === 2 && changes.includes("x") && changes.includes("y")) return `Moved frame ${f.frameName}`;
        if (changes.length === 1 && (changes[0] === "width" || changes[0] === "height")) return `Resized frame ${f.frameName}`;
        if (changes.length === 1 && changes[0] === "device") return cmd.device ? `Set ${f.frameName} to ${findDevice(cmd.device)!.name}` : `Removed device from ${f.frameName}`;
        return `Updated frame ${f.frameName}`;
      }
      case "add_background": {
        const spec = this.catalog.get(cmd.component);
        if (!spec) throw new EditError(`Unknown component "${cmd.component}". Use list_components.`);
        let parent = ed.container(cmd.parent);
        // frames usually hold one root layout div: the background goes inside it
        if ("frameName" in parent) {
          const kids = parent.children.filter((c) => c.kind !== "text");
          if (kids.length === 1 && kids[0].kind === "element") parent = kids[0];
        }
        const preset = cmd.preset ? spec.presets?.find((p) => p.name.toLowerCase() === cmd.preset!.toLowerCase()) : undefined;
        if (cmd.preset && !preset) throw new EditError(`${spec.name} has no preset "${cmd.preset}". Presets: ${spec.presets?.map((p) => p.name).join(", ") || "none"}`);
        const props: Record<string, Literal> = { className: "pointer-events-none absolute inset-0 -z-10 h-full w-full", ...(preset ? presetDiff(spec, preset.props) : {}) };
        ed.ensureImport(spec.name, importSpecifier(this.config.root, rel, spec.file));
        // the parent becomes the positioning + stacking context for the background
        if (parent.kind === "element") {
          const cls = parent.props.className;
          if (cls === undefined || cls.kind === "string") {
            const tokens = new Set((cls?.kind === "string" ? cls.value : "").split(/\s+/).filter(Boolean));
            const wanted = ["relative", "isolate"].filter((t) => !tokens.has(t) && !(t === "relative" && [...tokens].some((x) => /^(absolute|fixed|sticky)$/.test(x))));
            if (wanted.length) ed.setProp(parent, "className", [...wanted, ...tokens].join(" "));
          }
        }
        ed.insertChild(parent, 0, componentJsx(spec, props));
        return `Added ${spec.name} background`;
      }
      case "apply_preset": {
        const { node } = ed.node(cmd.id);
        const spec = this.catalog.get(node.name);
        const preset = spec?.presets?.find((p) => p.name.toLowerCase() === cmd.preset.toLowerCase());
        if (!spec || !preset) throw new EditError(`No preset "${cmd.preset}" for ${node.name}. Presets: ${spec?.presets?.map((p) => p.name).join(", ") || "none"}`);
        // write only what differs from the defaults; drop props the preset resets to default
        const diff = presetDiff(spec, preset.props);
        const next: Record<string, Literal> = {};
        for (const key of Object.keys(preset.props)) next[key] = key in diff ? diff[key] : null;
        for (const [k, v] of Object.entries(next)) if (v !== null || node.props[k] !== undefined) ed.setProp(node, k, v);
        ed.selectPaths.push(node.path);
        return `Applied ${preset.name} preset to ${spec.name}`;
      }
      case "import_route": {
        const built = this.pending as Extract<Pending, { kind: "route" }>;
        this.pending = null;
        for (const stmt of built.imports) ed.addImportStatement(stmt);
        const right = doc.frames.reduce((m, f) => Math.max(m, f.x + f.width), -80);
        const top = doc.frames.length ? Math.min(...doc.frames.map((f) => f.y)) : 0;
        const name = uniqueFrameName(doc, cmd.name ?? (built.route === "/" ? "Home" : built.route.split("/").filter(Boolean).map((p) => p.replace(/^./, (c) => c.toUpperCase())).join(" / ")));
        ed.insertFrame(frameCode({ name, x: cmd.x ?? right + 80, y: cmd.y ?? top, width: cmd.width ?? 1440, height: null, page: built.page ?? undefined, body: built.jsx }));
        return built.mode === "linked" ? `Linked ${built.route}` : built.mode === "inline" ? `Copied ${built.route} as layers` : `Copied ${built.route}`;
      }
      case "explore_copy": {
        const built = this.pending as Extract<Pending, { kind: "explore" }>;
        this.pending = null;
        const f = built.frame;
        for (const stmt of built.imports) ed.addImportStatement(stmt);
        // right of everything in the frame's row
        const h = (fr: { height: number | null }) => fr.height ?? 2000;
        const row = doc.frames.filter((o) => o.y < f.y + h(f) && o.y + h(o) > f.y);
        const right = Math.max(...row.map((o) => o.x + o.width), f.x + f.width);
        const name = uniqueFrameName(doc, cmd.name ?? `${f.frameName} exploration`);
        ed.insertFrame(frameCode({ name, x: right + 80, y: f.y, width: f.width, height: f.height, theme: f.theme, device: f.device, from: f.page!, body: built.jsx }));
        return `Explored a copy of ${f.frameName}`;
      }
      case "apply_to_page": {
        const plan = this.pending as Extract<Pending, { kind: "apply" }>;
        this.pending = null;
        for (const stmt of plan.imports) ed.addImportStatement(stmt);
        ed.replace(doc.frames[0].children[0], plan.jsx);
        return `Applied ${plan.frame.frameName} to ${plan.page}`;
      }
      case "add_animation": {
        const { node, parent } = ed.node(cmd.id);
        if ("frameName" in node) throw new EditError("Animate a layer inside the frame, not the frame itself.");
        if (node.kind === "expression") throw new EditError("Expressions can't be animated; pick the element around it.");
        const files = this.motion ?? motionFiles(this.config);
        const props: Record<string, Literal> = {};
        if (cmd.effect !== undefined) props.effect = cmd.effect;
        for (const k of ["delay", "duration", "stagger"] as const) if (cmd[k] !== undefined && !(cmd.kind === "reveal" && k === "stagger")) props[k] = Math.round(cmd[k]! * 100) / 100;
        if (cmd.once === false) props.once = false;
        const attrs = (defaults: Record<string, Literal>) =>
          Object.entries({ ...defaults, ...props })
            .map(([k, v]) => ` ${attrCode(k, v)}`)
            .join("");
        const solid = (n: CanvasNode) => n.children.filter((c) => !(c.kind === "text" && !c.text?.trim()));
        if (cmd.kind === "reveal") {
          const wrapper = node.name === "Reveal" ? node : parent?.name === "Reveal" && solid(parent).length === 1 ? parent : null;
          if (wrapper) {
            for (const [k, v] of Object.entries(props)) ed.setProp(wrapper, k, v);
            ed.selectPaths.push(node.path);
            return `Updated the reveal of ${wrapper === node ? "layer" : node.name}`;
          }
          ed.ensureImport("Reveal", importSpecifier(this.config.root, rel, files.reveal));
          ed.wrap([node], `<Reveal${attrs({ effect: "fade-up" })}>`, "</Reveal>");
          ed.selectPaths.length = 0;
          ed.selectPaths.push([...node.path, 0]);
          return `Added a ${props.effect ?? "fade-up"} reveal to ${node.kind === "text" ? "text" : node.name}`;
        }
        // text animation
        const kids = solid(node);
        const wrapper = node.name === "TextAnimate" ? node : kids.length === 1 && kids[0].name === "TextAnimate" ? kids[0] : parent?.name === "TextAnimate" ? parent : null;
        if (wrapper) {
          for (const [k, v] of Object.entries(props)) ed.setProp(wrapper, k, v);
          ed.selectPaths.push(node.path);
          return "Updated the text animation";
        }
        const hasText = (n: CanvasNode): boolean => n.kind === "text" || n.children.some(hasText);
        if (!hasText(node)) throw new EditError(`${node.name} has no text of its own here. Text inside a component (like <${node.name} />) lives in its file: animate a layer whose text is in this page.`);
        ed.ensureImport("TextAnimate", importSpecifier(this.config.root, rel, files.text));
        const open = `<TextAnimate${attrs({ effect: "words" })}>`;
        if (node.kind === "text") ed.wrapInline([node], open, "</TextAnimate>");
        else ed.wrapInline(node.children, open, "</TextAnimate>");
        ed.selectPaths.length = 0;
        ed.selectPaths.push(node.kind === "text" ? [...node.path, 0] : node.path);
        return `Added a ${props.effect ?? "words"} text animation to ${node.kind === "text" ? "text" : node.name}`;
      }
      case "remove_animation": {
        const { node, parent } = ed.node(cmd.id);
        const name = cmd.kind === "reveal" ? "Reveal" : "TextAnimate";
        const kids = node.children.filter((c) => !(c.kind === "text" && !c.text?.trim()));
        const wrapper = node.name === name ? node : parent?.name === name ? parent : kids.length === 1 && kids[0].name === name ? kids[0] : null;
        if (!wrapper) throw new EditError(`${node.name} has no ${cmd.kind === "reveal" ? "reveal" : "text animation"}.`);
        ed.unwrap(wrapper);
        // keep the layer the user had selected
        ed.selectPaths.length = 0;
        ed.selectPaths.push(wrapper === kids[0] ? node.path : wrapper.path);
        return cmd.kind === "reveal" ? "Removed the reveal" : "Removed the text animation";
      }
      case "create_component": {
        const made = this.pending as Extract<Pending, { kind: "component" }>;
        this.pending = null;
        ed.ensureImport(made.name, importSpecifier(this.config.root, rel, made.file));
        if (cmd.from) {
          const { node } = ed.node(cmd.from);
          ed.replace(node, `<${made.name} />`);
          return `Made ${node.name} a component: ${made.name}`;
        }
        if (!cmd.parent) return `Created component ${made.name}`;
        ed.insertChild(ed.container(cmd.parent), cmd.index, `<${made.name} />`);
        return `Created component ${made.name}`;
      }
      case "add_component_frame": {
        const spec = this.catalog.get(cmd.component);
        if (!spec) throw new EditError(`Unknown component "${cmd.component}". Use list_components.`);
        if (spec.library) throw new EditError(`${spec.name} comes from ${spec.library}: it can't be edited here.`);
        const existing = doc.frames.find((f) => f.component === `${spec.file}#${spec.name}`);
        if (existing) {
          ed.selectPaths.push(existing.path);
          return `Opened ${spec.name}`;
        }
        ed.ensureImport(spec.name, importSpecifier(this.config.root, rel, spec.file));
        const right = doc.frames.reduce((m, f) => Math.max(m, f.x + f.width), -80);
        const top = doc.frames.length ? Math.min(...doc.frames.map((f) => f.y)) : 0;
        ed.insertFrame(
          frameCode({
            name: uniqueFrameName(doc, spec.name),
            x: cmd.x ?? right + 80,
            y: cmd.y ?? top,
            width: cmd.width ?? 640,
            component: `${spec.file}#${spec.name}`,
            body: `<div className="p-10">\n  ${componentJsx(spec)}\n</div>`,
          }),
        );
        return `Opened main component ${spec.name}`;
      }
      case "create_variants": {
        const spec = this.catalog.get(cmd.component);
        if (!spec) throw new EditError(`Unknown component "${cmd.component}".`);
        const prop = spec.props.find((p) => p.name === cmd.prop);
        if (!prop) throw new EditError(`${spec.name} has no prop "${cmd.prop}".`);
        const values: Literal[] = prop.type === "enum" ? prop.options! : prop.type === "boolean" ? [false, true] : [];
        if (!values.length) throw new EditError(`Prop "${cmd.prop}" is ${prop.typeText}; variants need a union of string literals or a boolean.`);
        ed.ensureImport(spec.name, importSpecifier(this.config.root, rel, spec.file));
        const label = (v: Literal) => (typeof v === "string" ? v[0].toUpperCase() + v.slice(1) : `${prop.name}: ${v}`);
        const rows = indentBlock(values.map((v) => componentJsx(spec, { ...cmd.props, [prop.name]: v }, spec.acceptsChildren ? label(v) : undefined)).join("\n"));
        const right = doc.frames.reduce((m, f) => Math.max(m, f.x + f.width), -80);
        const name = uniqueFrameName(doc, `${spec.name} · ${prop.name}`);
        ed.insertFrame(frameCode({ name, x: cmd.x ?? right + 80, y: cmd.y ?? 0, width: 360, body: `<div className="flex flex-col gap-3 p-4">\n${rows}\n</div>` }));
        return `Created ${spec.name} ${prop.name} variants`;
      }
    }
  }

  private autoImport(ed: CanvasEditor, rel: string, jsx: string) {
    const known = new Set(["Frame", "Canvas", "Fragment"]);
    for (const name of componentNamesIn(jsx)) {
      if (known.has(name) || ed.doc.declared.includes(name)) continue;
      if (ed.doc.imports.some((i) => i.names.includes(name) || i.defaultName === name)) continue;
      const spec = this.catalog.get(name);
      if (!spec) throw new EditError(`Unknown component <${name}>. It is not imported in the canvas and not in the component catalog. Use list_components.`);
      ed.ensureImport(name, importSpecifier(this.config.root, rel, spec.file));
    }
  }

  private motion: MotionFiles | null = null;
  /** work resolved (async) in exec before the synchronous apply */
  private pending: Pending | null = null;
  private cleanCache = new Map<string, boolean>();
  async isPrettierClean(source: string, file: string): Promise<boolean> {
    const hit = this.cleanCache.get(source);
    if (hit !== undefined) return hit;
    let clean = false;
    try {
      clean = (await this.format(source, file)) === source;
    } catch {
      clean = false;
    }
    if (this.cleanCache.size > 20) this.cleanCache.clear();
    this.cleanCache.set(source, clean);
    return clean;
  }

  /** Pretty-prints an agent's JSX snippet so it lands in the file readable. */
  async formatSnippet(jsx: string): Promise<string> {
    try {
      this.prettier ??= require("prettier") as typeof import("prettier");
      const out = await this.prettier.format(`<>${jsx.trim()}</>`, { parser: "typescript", printWidth: 96, semi: false });
      const lines = out.trimEnd().replace(/^;/, "").split("\n");
      if (lines[0] !== "<>" || lines[lines.length - 1] !== "</>") return jsx.trim();
      return lines
        .slice(1, -1)
        .map((l) => l.replace(/^ {2}/, ""))
        .join("\n");
    } catch {
      return jsx.trim();
    }
  }

  private prettier: typeof import("prettier") | null = null;
  async format(source: string, file: string): Promise<string> {
    try {
      this.prettier ??= require("prettier") as typeof import("prettier");
      const options = (await this.prettier.resolveConfig(file)) ?? {};
      return await this.prettier.format(source, { printWidth: 100, ...options, filepath: file, parser: "typescript" });
    } catch (err) {
      throw new EditError(`Edit produced invalid code: ${(err as Error).message.split("\n")[0]}`);
    }
  }

  // ---------- history ----------

  private record(canvas: string, label: string, actor: Actor, before: string, after: string, ids: string[], file?: string, frames?: string[]) {
    const entry: HistoryEntry = { id: ++this.seq, canvas, label, actor, at: Date.now(), before, after, ids, ...(file ? { file } : {}), ...(frames?.length ? { frames } : {}) };
    const stack = this.undoStacks.get(canvas) ?? [];
    stack.push(entry);
    if (stack.length > 200) stack.shift();
    this.undoStacks.set(canvas, stack);
    this.redoStacks.set(canvas, []);
    this.feed.push(entry);
    if (this.feed.length > 300) this.feed.shift();
    this.emit({ type: "change", entry: publicEntry(entry), ids });
    this.emitHistory(canvas);
  }

  /** Changes still in effect (not undone) on a canvas since a time, oldest first. */
  changesSince(canvas: string, since: number): PublicEntry[] {
    return (this.undoStacks.get(canvas) ?? []).filter((e) => e.at > since).map(publicEntry);
  }

  historyState(canvas: string) {
    return { undo: this.undoStacks.get(canvas)?.length ?? 0, redo: this.redoStacks.get(canvas)?.length ?? 0 };
  }

  private emitHistory(canvas: string) {
    this.emit({ type: "history", canvas, ...this.historyState(canvas) });
  }

  undo(canvas: string, actor: Actor) {
    return this.step(canvas, actor, "undo");
  }
  redo(canvas: string, actor: Actor) {
    return this.step(canvas, actor, "redo");
  }

  private step(canvas: string, actor: Actor, dir: "undo" | "redo") {
    const job = this.queue.then(() => {
      const from = dir === "undo" ? this.undoStacks : this.redoStacks;
      const to = dir === "undo" ? this.redoStacks : this.undoStacks;
      const stack = from.get(canvas) ?? [];
      const entry = stack[stack.length - 1];
      if (!entry) throw new EditError(`Nothing to ${dir}.`);
      if (dir === "undo" && entry.before === "") throw new EditError("Cannot undo creating the canvas; delete the file instead.");
      stack.pop();
      const file = entry.file ? path.join(this.config.root, entry.file) : this.file(canvas);
      const current = entry.file ? fs.readFileSync(file, "utf8") : this.read(canvas);
      const expected = dir === "undo" ? entry.after : entry.before;
      if (current !== expected) {
        stack.push(entry);
        throw new EditError(`Cannot ${dir} "${entry.label}": ${entry.file ? path.basename(entry.file) : "the file"} changed since.`);
      }
      const next = dir === "undo" ? entry.before : entry.after;
      this.sources.set(entry.file ? `file:${entry.file}` : canvas, next);
      fs.writeFileSync(file, next);
      const list = to.get(canvas) ?? [];
      list.push(entry);
      to.set(canvas, list);
      const doc = this.doc(canvas);
      this.emit({ type: "doc", canvas, doc });
      if (entry.file) for (const c of this.canvasesLinking(entry.file)) if (c !== canvas) this.emit({ type: "doc", canvas: c, doc: this.doc(c) });
      const label = `${dir === "undo" ? "Undid" : "Redid"} “${entry.label}”`;
      const marker: HistoryEntry = { ...entry, id: ++this.seq, label, actor, at: Date.now() };
      this.feed.push(marker);
      this.emit({ type: "change", entry: publicEntry(marker), ids: [] });
      this.emitHistory(canvas);
      return { doc, label };
    });
    this.queue = job.catch(() => undefined);
    return job;
  }

  publicFeed(): PublicEntry[] {
    return this.feed.map(publicEntry);
  }

  // ---------- agents ----------

  touchAgent(session: string, name: string) {
    const now = Date.now();
    const existing = this.agents.get(session);
    this.agents.set(session, { session, name, since: existing?.since ?? now, lastSeen: now });
    // an agent reconnecting replaces its previous session
    for (const [id, a] of this.agents) if (id !== session && a.name === name && a.lastSeen < now - 1000) this.agents.delete(id);
    if (!existing || existing.name !== name || now - existing.lastSeen > 30_000) this.emit({ type: "agents", agents: [...this.agents.values()] });
  }

  /** Agents that went quiet for 15 minutes are shown as disconnected. */
  pruneAgents(maxIdle = 15 * 60_000) {
    const before = this.agents.size;
    for (const [id, a] of this.agents) if (Date.now() - a.lastSeen > maxIdle) this.agents.delete(id);
    if (this.agents.size !== before) this.emit({ type: "agents", agents: [...this.agents.values()] });
  }
  dropAgent(session: string) {
    if (this.agents.delete(session)) this.emit({ type: "agents", agents: [...this.agents.values()] });
  }

  ensureRoute() {
    if (!fs.existsSync(path.join(this.config.root, this.config.canvasDir))) {
      fs.mkdirSync(path.join(this.config.root, this.config.canvasDir), { recursive: true });
    }
    if (!this.canvases().length) {
      const file = canvasPath(this.config, "home");
      const content = this.homeCanvas();
      fs.writeFileSync(file, content);
      // pretty-print it once Prettier has loaded (the imported page keeps its own indentation otherwise)
      void this.format(content, file)
        .then((pretty) => {
          if (fs.readFileSync(file, "utf8") !== content) return;
          this.sources.set("home", pretty);
          fs.writeFileSync(file, pretty);
        })
        .catch(() => {});
    }
    return syncRoute(this.config);
  }

  /** First canvas of a project: its homepage as a linked frame when there is one, else the placeholder. */
  private homeCanvas(): string {
    try {
      const home = listRoutes(this.config).find((r) => r.route === "/");
      if (!home) return STARTER_CANVAS;
      const rel = path.relative(this.config.root, canvasPath(this.config, "home"));
      const empty = parseCanvas("home", rel, `import { Canvas, Frame } from "truecanvas";\nexport default function C() { return <Canvas></Canvas>; }\n`);
      const built = linkedFrameBody(this.config, empty, rel, home.file);
      const body = built.jsx.split("\n").join("\n        ");
      return `"use client";
import { Canvas, Frame } from "truecanvas";
${built.imports.join("\n")}

/** Your homepage, linked to ${home.file}: editing its layers edits that file. */
export default function HomeCanvas() {
  return (
    <Canvas>
      <Frame name="Home" x={0} y={0} width={1440} page=${JSON.stringify(home.file)}>
        ${body}
      </Frame>
    </Canvas>
  );
}
`;
    } catch {
      return STARTER_CANVAS;
    }
  }

  findFrameOf(canvas: string, ref: string) {
    const doc = this.doc(canvas);
    const frame = findFrame(doc, ref) ?? (findNode(doc, ref)?.frame ?? null);
    if (!frame) throw new EditError(`Frame "${ref}" not found in ${canvas}. Frames: ${doc.frames.map((f) => `"${f.frameName}"`).join(", ")}`);
    return frame;
  }
}

const COMPONENTS_CANVAS = `"use client";
import { Canvas, Frame } from "truecanvas";

/** Main components: edit one here and every instance in the app follows. */
export default function ComponentsCanvas() {
  return <Canvas></Canvas>;
}
`;

type Pending =
  | { kind: "component"; name: string; file: string }
  | { kind: "route"; route: string; page: string | null; imports: string[]; mode: "inline" | "component" | "linked"; jsx: string }
  | { kind: "explore"; frame: import("./types.js").CanvasFrame; imports: string[]; jsx: string }
  | { kind: "apply"; frame: import("./types.js").CanvasFrame; page: string; imports: string[]; jsx: string };

function validate(code: string): string {
  try {
    parseModule(code);
  } catch (err) {
    throw new EditError(`Edit produced invalid code: ${(err as Error).message}`);
  }
  return code;
}

function publicEntry(e: HistoryEntry): PublicEntry {
  const { before: _b, after: _a, ...rest } = e;
  return rest;
}

/** Frame names an edit touched: its targets before the edit and its results after. */
/** Every layer a command points at: id, ids, parent, and the layers create_component takes from. */
function nodeRefs(cmd: Command): string[] {
  const refs: string[] = [];
  if ("id" in cmd && cmd.id) refs.push(cmd.id);
  if ("ids" in cmd) refs.push(...cmd.ids);
  if ("parent" in cmd && cmd.parent) refs.push(cmd.parent);
  if ("from" in cmd && cmd.op === "create_component" && cmd.from) refs.push(cmd.from);
  return refs;
}

function touchedFrames(cmd: Command, ids: string[], before: CanvasDoc, after: CanvasDoc): string[] {
  const out = new Set<string>();
  const refs = nodeRefs(cmd);
  if ("frame" in cmd && cmd.frame) refs.push(cmd.frame);
  for (const ref of refs) {
    const f = findFrame(before, ref) ?? findNode(before, ref)?.frame;
    if (f) out.add(f.frameName);
  }
  for (const id of ids) {
    const f = findFrame(after, id) ?? findNode(after, id)?.frame;
    if (f) out.add(f.frameName);
  }
  return [...out];
}

const short = (s: string, max = 40) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

function pathId(doc: CanvasDoc, p: number[]): string | null {
  let node: CanvasNode | undefined = doc.frames[p[0]];
  for (const i of p.slice(1)) node = node?.children[i];
  return node?.id ?? null;
}

function touchedPaths(doc: CanvasDoc, cmd: Command): number[][] {
  if ("id" in cmd && cmd.id) {
    const found = findNode(doc, cmd.id);
    if (found) return [found.node.path];
  }
  return [];
}

/** Preset values that differ from the component's defaults (keeps generated code short). */
function presetDiff(spec: ComponentSpec, values: Record<string, unknown>): Record<string, Literal> {
  const out: Record<string, Literal> = {};
  for (const [k, v] of Object.entries(values)) {
    const def = spec.props.find((p) => p.name === k)?.default;
    if (JSON.stringify(def) !== JSON.stringify(v)) out[k] = v as Literal;
  }
  return out;
}

function uniqueFrameName(doc: CanvasDoc, wanted: string, current?: string) {
  const used = new Set(doc.frames.map((f) => f.frameName).filter((n) => n !== current));
  if (!used.has(wanted)) return wanted;
  for (let i = 2; ; i++) if (!used.has(`${wanted} ${i}`)) return `${wanted} ${i}`;
}

export function componentJsx(spec: ComponentSpec, props: Record<string, Literal> = {}, text?: string): string {
  const attrs: string[] = [];
  const merged: Record<string, Literal> = {};
  // Required props without defaults get a placeholder so the component renders.
  for (const p of spec.props) {
    if (p.optional || p.default !== undefined || p.name === "children") continue;
    if (p.type === "string") merged[p.name] = p.name === "title" || p.name === "label" ? spec.name : p.name;
    else if (p.type === "enum") merged[p.name] = p.options![0];
    else if (p.type === "boolean") merged[p.name] = false;
    else if (p.type === "number") merged[p.name] = 0;
  }
  Object.assign(merged, props);
  for (const [k, v] of Object.entries(merged)) if (v !== null && v !== undefined) attrs.push(attrCode(k, v));
  const open = `<${spec.name}${attrs.length ? ` ${attrs.join(" ")}` : ""}`;
  const childText = text ?? (spec.acceptsChildren && spec.props.find((p) => p.name === "children" && !p.optional) ? spec.name : undefined);
  return childText !== undefined ? `${open}>${textCode(childText)}</${spec.name}>` : `${open} />`;
}
