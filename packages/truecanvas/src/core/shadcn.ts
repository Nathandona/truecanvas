import fs from "node:fs";
import path from "node:path";
import { resolveAliasPath } from "./catalog.js";
import { detectPm, dlx, run } from "./pm.js";
import { posix } from "./paths.js";

/*
 * shadcn/ui: components are copied into the project as source (components/ui),
 * so once added they are ordinary project components and show up in the
 * catalog with their typed props. We drive the official CLI for that.
 */

export interface ShadcnStatus {
  /** components.json exists */
  initialized: boolean;
  /** where components land, relative to the project */
  uiDir: string | null;
  /** components already in the project */
  installed: string[];
}

export function shadcnStatus(root: string): ShadcnStatus {
  const file = path.join(root, "components.json");
  if (!fs.existsSync(file)) return { initialized: false, uiDir: null, installed: [] };
  let ui = "@/components/ui";
  try {
    ui = JSON.parse(fs.readFileSync(file, "utf8"))?.aliases?.ui ?? ui;
  } catch {
    // malformed components.json: keep the default location
  }
  const dir = resolveAliasPath(root, ui);
  let installed: string[] = [];
  try {
    installed = fs
      .readdirSync(dir)
      .filter((f) => /\.(tsx|jsx)$/.test(f))
      .map((f) => f.replace(/\.(tsx|jsx)$/, ""))
      .sort();
  } catch {
    installed = [];
  }
  return { initialized: true, uiDir: posix(path.relative(root, dir)), installed };
}

/** Used when the registry can't be reached (offline). */
const FALLBACK = "accordion alert alert-dialog aspect-ratio avatar badge breadcrumb button button-group calendar card carousel chart checkbox collapsible combobox command context-menu dialog drawer dropdown-menu empty field form hover-card input input-group input-otp item kbd label menubar navigation-menu pagination popover progress radio-group resizable scroll-area select separator sheet sidebar skeleton slider sonner spinner switch table tabs textarea toggle toggle-group tooltip".split(" ");

let registryCache: { at: number; names: string[] } | null = null;

/** Component names from the official registry, cached for an hour. */
export async function shadcnRegistry(): Promise<{ names: string[]; offline: boolean }> {
  if (registryCache && Date.now() - registryCache.at < 3_600_000) return { names: registryCache.names, offline: false };
  try {
    const res = await fetch("https://ui.shadcn.com/r/index.json", { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(String(res.status));
    const items = (await res.json()) as { name: string; type: string }[];
    const names = items.filter((i) => i.type === "registry:ui" && VALID.test(i.name)).map((i) => i.name).sort();
    if (!names.length) throw new Error("empty registry");
    registryCache = { at: Date.now(), names };
    return { names, offline: false };
  } catch {
    return { names: FALLBACK, offline: true };
  }
}

const VALID = /^[a-z0-9][a-z0-9-]*$/;

/** `shadcn init` with the defaults (writes components.json, lib/utils, theme CSS). */
export async function shadcnInit(root: string): Promise<{ ok: boolean; out: string }> {
  const [cmd, args] = dlx(detectPm(root), "shadcn@latest", ["init", "--defaults", "--yes", "--no-monorepo"]);
  return run(cmd, args, root);
}

/** `shadcn add <names>`; initializes the project first when needed. */
export async function shadcnAdd(root: string, names: string[]): Promise<{ ok: boolean; out: string; added: string[] }> {
  const bad = names.filter((n) => !VALID.test(n));
  if (bad.length) return { ok: false, out: `Not a component name: ${bad.join(", ")}`, added: [] };
  const before = new Set(shadcnStatus(root).installed);
  let log = "";
  if (!shadcnStatus(root).initialized) {
    const init = await shadcnInit(root);
    log += init.out;
    if (!init.ok) return { ok: false, out: log, added: [] };
  }
  const wanted = names.filter((n) => !before.has(n));
  if (wanted.length) {
    const [cmd, args] = dlx(detectPm(root), "shadcn@latest", ["add", ...wanted, "--yes"]);
    const res = await run(cmd, args, root);
    log += res.out;
    if (!res.ok) return { ok: false, out: log, added: [] };
  }
  const added = shadcnStatus(root).installed.filter((n) => !before.has(n));
  return { ok: true, out: log, added };
}
