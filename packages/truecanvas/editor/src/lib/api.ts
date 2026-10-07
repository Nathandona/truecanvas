import type { CanvasDoc, ComponentSpec } from "../../../src/core/types";

export type { CanvasDoc, CanvasNode, CanvasFrame, ComponentSpec, PropSpec, PropValue, Preset } from "../../../src/core/types";
export { DEVICES, findDevice, type Device } from "../../../src/core/devices";

export type Literal = string | number | boolean | null | (string | number | boolean)[];

export type Actor = { kind: "user" } | { kind: "agent"; name: string } | { kind: "file" };

export interface FeedEntry {
  id: number;
  canvas: string;
  label: string;
  actor: Actor;
  at: number;
  ids: string[];
}

export interface AgentInfo {
  session: string;
  name: string;
  since: number;
  lastSeen: number;
}

export interface DarkMode {
  strategy: "class" | "attribute";
  value: string;
  attribute?: string;
}

export interface ServerState {
  appUrl: string;
  framework: "next" | "vite";
  root: string;
  projectName: string;
  canvases: string[];
  darkMode: DarkMode;
  agents: AgentInfo[];
  feed: FeedEntry[];
  mcpUrl: string;
  componentsDir?: string;
}

export type ServerEvent =
  | { type: "doc"; canvas: string; doc: CanvasDoc }
  | { type: "canvases"; canvases: string[] }
  | { type: "catalog" }
  | { type: "change"; entry: FeedEntry; ids: string[] }
  | { type: "history"; canvas: string; undo: number; redo: number }
  | { type: "focus"; canvas: string; ids: string[]; actor: string }
  | { type: "motion"; canvas: string; frame: string; action: "play" | "replay" | "stop" }
  | { type: "agents"; agents: AgentInfo[] }
  | { type: "presence"; presence: Presence }
  | { type: "canvas-renamed"; from: string; to: string }
  | { type: "comments"; canvas: string }
  | { type: "git" };

export interface Presence {
  session: string;
  name: string;
  canvas: string;
  action: "reading" | "editing" | "looking";
  label: string;
  ids: string[];
  frame: string | null;
  at: number;
}

export type Command =
  | { op: "set_props"; canvas: string; id: string; props: Record<string, Literal> }
  | { op: "set_text"; canvas: string; id: string; text: string }
  | { op: "set_class"; canvas: string; id: string; className: string }
  | { op: "insert_jsx"; canvas: string; parent: string; index?: number; jsx: string }
  | { op: "insert_component"; canvas: string; parent: string; index?: number; component: string; props?: Record<string, Literal>; text?: string }
  | { op: "insert_icon"; canvas: string; parent: string; index?: number; library: string; name: string; className?: string }
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
  | { op: "import_route"; canvas: string; route: string; name?: string; width?: number; copy?: boolean }
  | { op: "explore_copy"; canvas: string; frame: string; name?: string }
  | { op: "apply_to_page"; canvas: string; frame: string }
  | { op: "add_animation"; canvas: string; id: string; kind: "reveal" | "text"; effect?: string; delay?: number; duration?: number; stagger?: number; once?: boolean }
  | { op: "remove_animation"; canvas: string; id: string; kind: "reveal" | "text" }
  | { op: "create_component"; canvas: string; name: string; from?: string; parent?: string; index?: number }
  | { op: "add_component_frame"; canvas: string; component: string }
  | { op: "create_variants"; canvas: string; component: string; prop: string };

export interface ShadcnStatus {
  initialized: boolean;
  uiDir: string | null;
  installed: string[];
}

export interface LibraryState {
  packageManager: string;
  icons: { id: string; label: string; package: string; from: string; homepage: string; version: string | null }[];
  shadcn: ShadcnStatus;
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export interface ShareResult {
  manifest: { id: string; frames: { name: string }[]; missing: string[]; external: string[] };
  preview: string;
  published: { url: string; versions: number; skipped: string[]; password: boolean } | null;
}

export const api = {
  state: () => call<ServerState>("/api/state"),
  canvas: (name: string) => call<{ doc: CanvasDoc; history: { undo: number; redo: number } }>(`/api/canvas?name=${encodeURIComponent(name)}`),
  components: () => call<{ components: ComponentSpec[] }>("/api/components"),
  libraries: () => call<LibraryState>("/api/libraries"),
  shareStatus: () => call<{ site: string | null }>("/api/share/status"),
  share: (body: { canvas: string; title?: string; password?: string; local?: boolean }) => call<ShareResult>("/api/share/snapshot", body),
  shadcnRegistry: () => call<{ names: string[]; offline: boolean; status: ShadcnStatus }>("/api/libraries/shadcn"),
  icons: (library: string, q: string, limit = 240) => call<{ total: number; icons: { name: string; svg: string }[] }>(`/api/icons?library=${encodeURIComponent(library)}&q=${encodeURIComponent(q)}&limit=${limit}`),
  installIcons: (id: string) => call<{ ok: boolean; out: string; package: string; state: LibraryState }>("/api/libraries/icons", { id }),
  addShadcn: (names: string[]) => call<{ ok: boolean; out: string; added: string[]; state: LibraryState }>("/api/libraries/shadcn", { names }),
  command: (cmd: Command) => call<{ doc: CanvasDoc; ids: string[]; label: string }>("/api/command", cmd),
  undo: (canvas: string) => call<{ doc: CanvasDoc; label: string }>("/api/undo", { canvas }),
  redo: (canvas: string) => call<{ doc: CanvasDoc; label: string }>("/api/redo", { canvas }),
  selection: (canvas: string | null, ids: string[]) => call("/api/selection", { canvas, ids }),
  createCanvas: (name: string) => call<{ canvases: string[] }>("/api/canvases", { name }),
  pages: () => call<{ canvases: { name: string; frames: number }[] }>("/api/canvases"),
  renameCanvas: (from: string, to: string) => call<{ name: string }>("/api/canvases/rename", { from, to }),
  duplicateCanvas: (name: string) => call<{ name: string }>("/api/canvases/duplicate", { name }),
  deleteCanvas: (name: string) => call<{ ok: true }>("/api/canvases/delete", { name }),
  restoreCanvas: (name: string) => call<{ name: string }>("/api/canvases/restore", { name }),
  open: (canvas: string, id?: string) => call("/api/open", { canvas, id }),
  openFile: (file: string) => call("/api/open-file", { file }),
  tokens: () => call<TokenData>("/api/tokens"),
  routes: () => call<{ routes: { route: string; file: string; dynamic: boolean }[] }>("/api/routes"),
  gitStatus: () => call<GitStatus>("/api/git/status"),
  gitBranches: () => call<{ current: string | null; local: string[]; remote: string[] }>("/api/git/branches"),
  gitLog: (canvas?: string) => call<{ commits: GitCommit[] }>(`/api/git/log${canvas ? `?canvas=${encodeURIComponent(canvas)}` : ""}`),
  gitFetch: () => call<GitStatus>("/api/git/fetch", {}),
  gitCommit: (message: string, scope: "canvas" | "all") => call<{ hash: string }>("/api/git/commit", { message, scope }),
  gitPush: () => call<{ ok: true }>("/api/git/push", {}),
  gitPull: () => call<{ ok: true }>("/api/git/pull", {}),
  gitSwitch: (branch: string, create = false) => call<{ ok: true }>("/api/git/switch", { branch, create }),
  gitChanges: () => call<{ pages: PageReview[] }>("/api/git/changes"),
  gitDiff: (canvas: string) => call<{ diff: string }>(`/api/git/diff?canvas=${encodeURIComponent(canvas)}`),
  gitPr: (fresh = false) => call<{ pr: PullRequest | null; github: boolean }>(`/api/git/pr${fresh ? "?fresh=1" : ""}`),
  gitCreatePr: (body: { title: string; body?: string; screenshots?: boolean; draft?: boolean }) => call<{ url: string }>("/api/git/pr", body),
  gitPublish: (name: string, isPrivate = true) => call<{ remote: string }>("/api/git/publish", { name, private: isPrivate }),
  previewUrl: (canvas: string, frame: string, side: "before" | "after", version: string) =>
    `/api/git/preview?canvas=${encodeURIComponent(canvas)}&frame=${encodeURIComponent(frame)}&side=${side}&v=${encodeURIComponent(version)}`,
  compare: (canvas: string, ref: string) => call<{ name: string; doc: CanvasDoc; changes: Record<string, FrameChange> }>("/api/compare", { canvas, ref }),
  clearCompare: (canvas?: string) => call<{ ok: true }>("/api/compare/clear", { canvas }),
  comments: (canvas: string) => call<{ threads: CommentThread[] }>(`/api/comments?canvas=${encodeURIComponent(canvas)}`),
  addComment: (b: { canvas: string; frame: string; x: number; y: number; node: { path: string; name: string } | null; text: string }) => call<{ thread: CommentThread }>("/api/comments", b),
  replyComment: (canvas: string, id: string, text: string) => call<{ thread: CommentThread }>("/api/comments/reply", { canvas, id, text }),
  resolveComment: (canvas: string, id: string, resolved: boolean) => call<{ thread: CommentThread }>("/api/comments/resolve", { canvas, id, resolved }),
  deleteComment: (canvas: string, id: string) => call<{ ok: true }>("/api/comments/delete", { canvas, id }),
  source: (canvas: string, id: string) => call<{ code: string }>("/api/source", { canvas, id }),
};

/**
 * Server events over SSE. Reconnects after a drop; `onResync` runs on every
 * reconnect, since events sent while disconnected are lost.
 */
export function subscribe(onEvent: (e: ServerEvent) => void, onStatus: (connected: boolean) => void, onResync: () => void = () => {}) {
  let es: EventSource | null = null;
  let closed = false;
  let retry = 0;
  let dropped = false;
  const connect = () => {
    if (closed) return;
    es = new EventSource("/api/events");
    es.onopen = () => {
      onStatus(true);
      if (dropped) onResync();
      dropped = false;
    };
    es.onmessage = (m) => onEvent(JSON.parse(m.data));
    es.onerror = () => {
      onStatus(false);
      dropped = true;
      es?.close();
      clearTimeout(retry);
      if (!closed) retry = window.setTimeout(connect, 1500);
    };
  };
  connect();
  return () => {
    closed = true;
    clearTimeout(retry);
    es?.close();
  };
}

export interface TokenData {
  colors: { name: string; light: string; dark: string | null }[];
  radius: string[];
  shadows: string[];
  textSizes: string[];
  fonts: string[];
}

export type FrameChange = "changed" | "added" | "removed" | "same";

export interface GitStatus {
  repo: boolean;
  root: string | null;
  branch: string | null;
  unborn: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: { path: string; status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted"; staged: boolean }[];
  user: string | null;
  /** page and layout files shown by linked frames */
  linked?: string[];
  defaultBranch: string | null;
  remote: string | null;
}

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  at: number;
}

export interface CommentAuthor {
  name: string;
  /** client: from a share link */
  kind: "user" | "agent" | "client";
}

export interface CommentThread {
  id: string;
  frame: string;
  x: number;
  y: number;
  node: { path: string; name: string } | null;
  resolved: boolean;
  resolvedBy?: CommentAuthor;
  messages: { id: string; author: CommentAuthor; text: string; at: number }[];
  createdAt: number;
  /** a client's thread on a share link: replies go back to the client */
  share?: { link: string; version: string };
}

export interface FrameReview {
  name: string;
  status: "changed" | "added" | "removed";
  changes: { label: string; actor: string; at: number }[];
}

export interface PageReview {
  canvas: string;
  status: "modified" | "added" | "deleted";
  frames: FrameReview[];
  files: string[];
}

export interface PullRequest {
  number: number;
  url: string;
  title: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  draft: boolean;
  review: "APPROVED" | "CHANGES_REQUESTED" | "REVIEW_REQUIRED" | null;
  checks: { passed: number; failed: number; pending: number };
}
