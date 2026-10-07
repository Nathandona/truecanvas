import { create } from "zustand";
import { fromServer, scopeDoc, unscopeCommand } from "./scope";
import { api, type PageReview, type PullRequest, type CommentThread, type FrameChange, type GitStatus, type TokenData, type Presence, type AgentInfo, type CanvasDoc, type CanvasFrame, type CanvasNode, type Command, type ComponentSpec, type DarkMode, type FeedEntry, type RoomPerson, type SessionState } from "./api";

export type Tool = "select" | "frame" | "hand" | "interact" | "comment";
export type ThemeMode = "system" | "light" | "dark";
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface IndexEntry {
  node: CanvasNode;
  parent: CanvasNode | null;
  frame: CanvasFrame;
  depth: number;
}
export interface Toast {
  id: number;
  text: string;
  tone: "error" | "info";
  action?: { label: string; run: () => void };
}
export interface Flash {
  key: number;
  id: string;
  frame: string;
  actor: string;
  color: string;
  at: number;
}

const AGENT_COLORS: Record<string, string> = {
  "claude-code": "#d97757",
  claude: "#d97757",
  "claude-ai": "#d97757",
  cursor: "#7c6cf2",
  "codex-mcp-client": "#10a37f",
  codex: "#10a37f",
};
const PALETTE = ["#e5484d", "#f76b15", "#ffc53d", "#30a46c", "#0090ff", "#8e4ec6", "#d6409f"];

/** Stable color per agent: brand-ish for known clients, hashed for the rest. */
/** "claude-code" → "Claude Code": how an agent is named in the UI. */
export function agentLabel(name: string) {
  const known: Record<string, string> = { "claude-code": "Claude Code", cursor: "Cursor", "codex-mcp-client": "Codex", codex: "Codex", "claude-ai": "Claude" };
  return known[name] ?? name.replace(/[-_]/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export function agentColor(name: string): string {
  if (AGENT_COLORS[name]) return AGENT_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length];
}

interface State {
  ready: boolean;
  connected: boolean;
  appUrl: string;
  framework: "next" | "vite";
  projectName: string;
  /** where new components go, e.g. "src/components" */
  componentsDir: string;
  /** Create / New component dialog */
  componentDialog: { from: string | null } | null;
  /** the Libraries dialog (icon sets, shadcn/ui) and its tab */
  libraryDialog: { tab: "icons" | "shadcn" } | null;
  shareDialog: boolean;
  /** where a layer dragged in the layers tree would land */
  layerDrop: { id: string; where: "before" | "after" | "inside" } | null;
  mcpUrl: string;
  darkMode: DarkMode;
  canvases: string[];
  canvas: string | null;
  doc: CanvasDoc | null;
  docError: string | null;
  index: Map<string, IndexEntry>;
  history: { undo: number; redo: number };
  components: ComponentSpec[];
  tokens: TokenData | null;
  feed: FeedEntry[];
  agents: AgentInfo[];

  selection: string[];
  hover: string | null;
  /** Measured rects (frame-local) of nodes we care about: hovered, selected, flashing. */
  rects: Record<string, Rect | null>;
  frameHeights: Record<string, number>;
  frameErrors: Record<string, string | null>;
  frameReady: Record<string, boolean>;
  layoutTick: number;

  tool: Tool;
  camera: Camera;
  canvasTheme: ThemeMode;
  uiTheme: ThemeMode;
  motionPaused: boolean;
  /** frame being played: one screen tall, scrolling inside, so scroll animations run */
  playing: string | null;
  deviceChrome: boolean;
  leftTab: "layers" | "components";
  rightTab: "design" | "comments" | "agent";
  expanded: Set<string>;
  toasts: Toast[];
  flashes: Flash[];
  /** live agent cursors, by MCP session */
  presence: Record<string, Presence>;
  /** live sessions on share links, by canvas */
  sessions: Record<string, SessionState>;
  /** people in a live session's room (clients, other studio members), by id, with their cursor */
  roomPeople: Record<string, RoomPerson & { canvas: string; x: number | null; y: number | null }>;
  pages: { name: string; frames: number }[];
  /** layer keys (path + name) hidden / locked in the editor only */
  hidden: Set<string>;
  locked: Set<string>;
  layerQuery: string;
  renamingLayer: string | null;
  git: GitStatus | null;
  /** uncommitted design changes, per page */
  review: PageReview[];
  pr: { pr: PullRequest | null; github: boolean } | null;
  /** the Review changes sheet: open on a page/frame */
  reviewing: { canvas: string; frame: string | null } | null;
  /** commit message being written (shared by the Git popover and the Review sheet) */
  commitMessage: string;
  commitTouched: boolean;
  /** an older version of this page rendered next to (or over) the current one */
  compare: { ref: string; label: string; name: string; doc: CanvasDoc; changes: Record<string, FrameChange>; mode: "side" | "overlay"; opacity: number } | null;
  threads: CommentThread[];
  openThread: string | null;
  draftComment: { frame: string; x: number; y: number; node: { path: string; name: string } | null } | null;
  showResolved: boolean;
  appStatus: "checking" | "up" | "down";
  editingText: string | null;
  busy: number;
}

interface Actions {
  set: (p: Partial<State>) => void;
  setDoc: (doc: CanvasDoc) => void;
  select: (ids: string[], opts?: { reveal?: boolean }) => void;
  run: (cmd: Command, opts?: { select?: boolean }) => Promise<string[] | null>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
  toast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  /** editor-only layer state, persisted per canvas */
  toggleLayerFlag: (flag: "hidden" | "locked", node: CanvasNode) => void;
  frameOf: (id: string) => CanvasFrame | null;
}

const stored = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};

export function buildIndex(doc: CanvasDoc | null): Map<string, IndexEntry> {
  const map = new Map<string, IndexEntry>();
  if (!doc) return map;
  for (const frame of doc.frames) {
    map.set(frame.id, { node: frame, parent: null, frame, depth: 0 });
    const visit = (n: CanvasNode, parent: CanvasNode, depth: number) => {
      map.set(n.id, { node: n, parent, frame, depth });
      for (const c of n.children) visit(c, n, depth + 1);
    };
    for (const c of frame.children) visit(c, frame, 1);
  }
  return map;
}

let toastSeq = 0;

export const useStore = create<State & Actions>((set, get) => ({
  ready: false,
  connected: false,
  appUrl: "",
  framework: "next",
  projectName: "",
  componentsDir: "components",
  componentDialog: null,
  libraryDialog: null,
  shareDialog: false,
  layerDrop: null,
  mcpUrl: "",
  darkMode: { strategy: "class", value: "dark" },
  canvases: [],
  canvas: null,
  doc: null,
  docError: null,
  index: new Map(),
  history: { undo: 0, redo: 0 },
  components: [],
  tokens: null,
  feed: [],
  agents: [],
  selection: [],
  hover: null,
  rects: {},
  frameHeights: {},
  frameErrors: {},
  frameReady: {},
  layoutTick: 0,
  tool: "select",
  camera: { x: 0, y: 0, zoom: 1 },
  canvasTheme: stored<ThemeMode>("tc:canvasTheme", "system"),
  uiTheme: stored<ThemeMode>("tc:uiTheme", "system"),
  motionPaused: stored<boolean>("tc:motionPaused", false),
  playing: null,
  deviceChrome: stored<boolean>("tc:deviceChrome", true),
  leftTab: "layers",
  rightTab: "design",
  expanded: new Set(),
  toasts: [],
  flashes: [],
  presence: {},
  sessions: {},
  roomPeople: {},
  pages: [],
  hidden: new Set(),
  locked: new Set(),
  layerQuery: "",
  renamingLayer: null,
  git: null,
  review: [],
  pr: null,
  reviewing: null,
  commitMessage: "",
  commitTouched: false,
  compare: null,
  threads: [],
  openThread: null,
  draftComment: null,
  showResolved: false,
  appStatus: "checking",
  editingText: null,
  busy: 0,

  set: (p) => set(p),

  setDoc: (incoming) => {
    const prev = get();
    // command responses and server events race: never replace a newer tree with an older one
    if (prev.doc && prev.doc.name === incoming.name && incoming.rev !== undefined && prev.doc.rev !== undefined && incoming.rev < prev.doc.rev) return;
    // A syntax error while someone is mid-edit: keep showing the last good tree.
    if (incoming.error && prev.doc && !prev.doc.error && prev.doc.name === incoming.name) {
      set({ docError: incoming.error });
      return;
    }
    // ids shared by several frames (one page linked twice) are scoped per frame
    const doc = scopeDoc(incoming);
    if (prev.docError) set({ docError: null });
    const index = buildIndex(doc);
    // Keep selection when ids survive; otherwise follow the same tree paths.
    const prevIndex = prev.index;
    const remap = (id: string) => {
      if (index.has(id)) return id;
      const old = prevIndex.get(id);
      if (!old) return null;
      for (const [nid, e] of index) if (e.node.path.join(".") === old.node.path.join(".") && e.node.name === old.node.name) return nid;
      return null;
    };
    const selection = prev.selection.map(remap).filter(Boolean) as string[];
    set({ doc, index, selection, hover: prev.hover && index.has(prev.hover) ? prev.hover : null });
  },

  select: (ids, opts) => {
    const { index, expanded } = get();
    let nextExpanded = expanded;
    if (opts?.reveal !== false && ids.length) {
      nextExpanded = new Set(expanded);
      for (const id of ids) {
        const entry = index.get(id);
        if (!entry) continue;
        nextExpanded.add(entry.frame.id);
        // expand ancestors
        let path = entry.node.path.slice(0, -1);
        while (path.length > 1) {
          for (const [nid, e] of index) if (e.node.path.join(".") === path.join(".")) nextExpanded.add(nid);
          path = path.slice(0, -1);
        }
      }
    }
    set({ selection: ids, expanded: nextExpanded, editingText: null });
  },

  frameOf: (id) => get().index.get(id)?.frame ?? null,

  run: async (cmd, opts) => {
    set({ busy: get().busy + 1 });
    try {
      // the frame the user is working in: new layers are selected there
      const preferFrame = get().index.get(get().selection[0] ?? "")?.frame.id ?? null;
      const res = await api.command(unscopeCommand(cmd));
      get().setDoc(res.doc);
      const index = get().index;
      const ids = res.ids.map((id) => fromServer(index, id, preferFrame));
      if (opts?.select !== false && ids.length) get().select(ids);
      return ids;
    } catch (err) {
      get().toast((err as Error).message, "error");
      return null;
    } finally {
      set({ busy: get().busy - 1 });
    }
  },

  undo: async () => {
    const { canvas } = get();
    if (!canvas) return;
    try {
      const res = await api.undo(canvas);
      get().setDoc(res.doc);
    } catch (err) {
      get().toast((err as Error).message, "info");
    }
  },

  redo: async () => {
    const { canvas } = get();
    if (!canvas) return;
    try {
      const res = await api.redo(canvas);
      get().setDoc(res.doc);
    } catch (err) {
      get().toast((err as Error).message, "info");
    }
  },

  toast: (text, tone = "error", action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone, action }] });
    setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), action ? 8000 : tone === "error" ? 5000 : 2600);
  },

  toggleLayerFlag: (flag, node) => {
    const key = layerKey(node);
    const next = new Set(get()[flag]);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    set({ [flag]: next } as Pick<State, "hidden">);
    const canvas = get().canvas;
    if (canvas) persist(`tc:${flag}:${canvas}`, [...next]);
  },
}));

export const persist = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
};

export function effectiveTheme(frame: CanvasFrame, canvasTheme: ThemeMode): ThemeMode {
  return frame.theme ?? canvasTheme;
}

/** Stable-ish key for editor-only layer state: tree path + tag/component name. */
export function layerKey(n: CanvasNode): string {
  return `${n.path.join(".")}:${n.name}`;
}

export function loadLayerFlags(canvas: string) {
  useStore.setState({
    hidden: new Set(stored<string[]>(`tc:hidden:${canvas}`, [])),
    locked: new Set(stored<string[]>(`tc:locked:${canvas}`, [])),
  });
}

/** Ids of nodes hidden in the editor, plus whether a node sits under a locked one. */
export function isLockedDeep(id: string): boolean {
  const s = useStore.getState();
  let entry = s.index.get(id);
  while (entry) {
    if (s.locked.has(layerKey(entry.node))) return true;
    entry = entry.parent ? s.index.get(entry.parent.id) : undefined;
  }
  return false;
}

/** Display name for a layer. */
export function layerName(n: CanvasNode): string {
  if ("frameName" in n) return (n as CanvasFrame).frameName;
  const custom = n.props["data-name"];
  if (custom?.kind === "string" && custom.value) return custom.value;
  if (n.kind === "text") return n.text ?? "";
  if (n.kind === "expression") return `{${n.name}}`;
  if (n.kind === "fragment") return "Fragment";
  return n.name;
}
