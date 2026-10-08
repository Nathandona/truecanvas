import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ProjectRecord {
  path: string;
  name: string;
  lastOpened: number;
}

export interface ProjectInfo extends ProjectRecord {
  /** package.json depends on next */
  next: boolean;
  /** truecanvas is installed */
  ready: boolean;
  canvases: number;
  /** open threads clients started on share links: feedback waiting for the studio */
  clientComments: number;
  exists: boolean;
}

const CONFIG_DIR = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "truecanvas");
const FILE = path.join(CONFIG_DIR, "projects.json");

/** Recent projects, stored in ~/.config/truecanvas/projects.json. */
export class ProjectStore {
  private list: ProjectRecord[] = [];

  constructor() {
    try {
      this.list = JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      this.list = [];
    }
  }

  private save() {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(this.list, null, 2));
  }

  all(): ProjectInfo[] {
    return [...this.list].sort((a, b) => b.lastOpened - a.lastOpened).map((p) => ({ ...p, ...inspect(p.path) }));
  }

  touch(dir: string) {
    const abs = path.resolve(dir);
    const existing = this.list.find((p) => p.path === abs);
    if (existing) existing.lastOpened = Date.now();
    else this.list.push({ path: abs, name: projectName(abs), lastOpened: Date.now() });
    this.save();
  }

  forget(dir: string) {
    this.list = this.list.filter((p) => p.path !== path.resolve(dir));
    this.save();
  }
}

function readPkg(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    return null;
  }
}

export function projectName(dir: string): string {
  const pkg = readPkg(dir);
  const name = typeof pkg?.name === "string" ? pkg.name : "";
  return name && !name.startsWith("@") ? name : path.basename(dir);
}

export function inspect(dir: string): Omit<ProjectInfo, keyof ProjectRecord> {
  const pkg = readPkg(dir);
  if (!pkg) return { next: false, ready: false, canvases: 0, clientComments: 0, exists: fs.existsSync(dir) };
  const deps = { ...(pkg.dependencies as object), ...(pkg.devDependencies as object) } as Record<string, string>;
  let canvases = 0;
  let clientComments = 0;
  for (const d of ["canvas", "src/canvas"]) {
    let files: string[];
    try {
      files = fs.readdirSync(path.join(dir, d));
    } catch {
      continue; // no canvas dir
    }
    canvases += files.filter((f) => f.endsWith(".canvas.tsx")).length;
    for (const f of files.filter((f) => f.endsWith(".comments.json"))) {
      try {
        const { threads } = JSON.parse(fs.readFileSync(path.join(dir, d, f), "utf8")) as { threads?: { resolved?: boolean; messages?: { author?: { kind?: string } }[] }[] };
        clientComments += (threads ?? []).filter((t) => !t.resolved && t.messages?.[0]?.author?.kind === "client").length;
      } catch {
        /* unreadable: no count */
      }
    }
  }
  // `next`: an app Truecanvas can run in (Next.js, or Vite + React)
  return { next: "next" in deps || ("vite" in deps && "react" in deps), ready: "truecanvas" in deps, canvases, clientComments, exists: true };
}

/** Next.js and Vite apps in the usual code folders (a few levels deep, skipping node_modules). */
export function discover(): { path: string; name: string; ready: boolean }[] {
  const home = os.homedir();
  const roots = ["Github", "GitHub", "github", "Projects", "projects", "code", "Code", "dev", "src", "Developer", "Documents", "work"]
    .map((d) => path.join(home, d))
    .filter((d) => fs.existsSync(d));
  const found: { path: string; name: string; ready: boolean }[] = [];
  let visited = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || visited > 3000 || found.length > 60) return;
    visited++;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    if (entries.some((e) => e.name === "package.json")) {
      const info = inspect(dir);
      if (info.next) found.push({ path: dir, name: projectName(dir), ready: info.ready });
    }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules" || e.name === "dist" || e.name === "build") continue;
      walk(path.join(dir, e.name), depth + 1);
    }
  };
  for (const r of roots) walk(r, 0);
  return found;
}

/** Sub-folders for the "Open folder" picker. */
export function listDirs(dir: string): { path: string; dirs: { name: string; next: boolean }[] } {
  const abs = path.resolve(dir.replace(/^~(?=$|[\\/])/, os.homedir()));
  const dirs = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
    .map((e) => ({ name: e.name, next: inspect(path.join(abs, e.name)).next }))
    .sort((a, b) => Number(b.next) - Number(a.next) || a.name.localeCompare(b.name));
  return { path: abs, dirs };
}
