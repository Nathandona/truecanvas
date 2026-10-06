import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

/*
 * Icon libraries. They export hundreds or thousands of components, too many
 * for the TypeScript catalog, so each installed set is rendered once to SVG in
 * a short-lived worker (with the project's own React) and cached on disk. The
 * picker and agents search that cache; inserting writes `<Search className="size-4" />`
 * and its import.
 */

export interface IconLibrary {
  id: string;
  label: string;
  /** npm package to install */
  package: string;
  /** module the icons are imported from */
  from: string;
  homepage: string;
  /** keeps one name per icon: drops aliases and non-icon exports */
  pick: (name: string, all: Set<string>) => boolean;
}

const aliasOf = (name: string, all: Set<string>, suffix: string) => name.endsWith(suffix) && all.has(name.slice(0, -suffix.length));

export const ICON_LIBRARIES: IconLibrary[] = [
  {
    id: "lucide",
    label: "Lucide",
    package: "lucide-react",
    from: "lucide-react",
    homepage: "https://lucide.dev/icons",
    pick: (n, all) => !n.startsWith("Lucide") && !aliasOf(n, all, "Icon") && n !== "Icon",
  },
  {
    id: "tabler",
    label: "Tabler Icons",
    package: "@tabler/icons-react",
    from: "@tabler/icons-react",
    homepage: "https://tabler.io/icons",
    pick: (n) => /^Icon[A-Z0-9]/.test(n),
  },
  {
    id: "phosphor",
    label: "Phosphor",
    package: "@phosphor-icons/react",
    from: "@phosphor-icons/react",
    homepage: "https://phosphoricons.com",
    pick: (n, all) => !["IconBase", "IconContext", "SSRBase"].includes(n) && !aliasOf(n, all, "Icon"),
  },
  {
    id: "heroicons",
    label: "Heroicons outline",
    package: "@heroicons/react",
    from: "@heroicons/react/24/outline",
    homepage: "https://heroicons.com",
    pick: (n) => n.endsWith("Icon"),
  },
  {
    id: "heroicons-solid",
    label: "Heroicons solid",
    package: "@heroicons/react",
    from: "@heroicons/react/24/solid",
    homepage: "https://heroicons.com",
    pick: (n) => n.endsWith("Icon"),
  },
  {
    id: "radix",
    label: "Radix Icons",
    package: "@radix-ui/react-icons",
    from: "@radix-ui/react-icons",
    homepage: "https://www.radix-ui.com/icons",
    pick: (n) => n.endsWith("Icon"),
  },
];

export function iconLibrary(id: string): IconLibrary | undefined {
  return ICON_LIBRARIES.find((l) => l.id === id || l.package === id || l.from === id);
}

export interface Icon {
  name: string;
  svg: string;
}

/** The version installed in the project, or null. */
export function installedVersion(root: string, pkg: string): string | null {
  try {
    const req = createRequire(path.join(root, "package.json"));
    // package.json may not be exported; walk up from the resolved entry instead
    let dir = path.dirname(req.resolve(pkg));
    for (let i = 0; i < 6; i++, dir = path.dirname(dir)) {
      const file = path.join(dir, "package.json");
      if (fs.existsSync(file)) {
        const json = JSON.parse(fs.readFileSync(file, "utf8"));
        if (json.name === pkg) return json.version ?? null;
      }
    }
  } catch {
    // not installed
  }
  return null;
}

/** Renders every icon of a library to an SVG string (runs inside the worker). */
export async function renderIconSet(root: string, id: string): Promise<Icon[]> {
  const lib = iconLibrary(id);
  if (!lib) throw new Error(`Unknown icon library "${id}".`);
  const req = createRequire(path.join(root, "package.json"));
  const load = async (spec: string) => import(pathToFileURL(req.resolve(spec)).href);
  const React = await load("react");
  const server = await load("react-dom/server");
  const mod = await load(lib.from);
  const createElement = (React.createElement ?? React.default?.createElement) as (t: unknown, p: unknown) => unknown;
  const renderToStaticMarkup = (server.renderToStaticMarkup ?? server.default?.renderToStaticMarkup) as (el: unknown) => string;
  const exports = { ...(mod.default && typeof mod.default === "object" ? mod.default : {}), ...mod } as Record<string, unknown>;
  const all = new Set(Object.keys(exports).filter((n) => /^[A-Z]/.test(n)));
  const out: Icon[] = [];
  for (const name of [...all].sort()) {
    if (!lib.pick(name, all)) continue;
    const C = exports[name];
    if (!(typeof C === "function" || (typeof C === "object" && C !== null && "$$typeof" in C))) continue;
    try {
      const svg = renderToStaticMarkup(createElement(C, {}));
      if (svg.startsWith("<svg")) out.push({ name, svg: svg.replace(/\s(?:class|data-[\w-]+)="[^"]*"/g, "") });
    } catch {
      // not an icon (a context, a helper)
    }
  }
  return out;
}

function cacheFile(root: string, id: string, version: string) {
  return path.join(root, "node_modules", ".cache", "truecanvas", "icons", `${id}@${version}.json`);
}

let memo: { key: string; icons: Icon[] } | null = null;
const inflight = new Map<string, Promise<Icon[]>>();

/** Every icon of an installed library, from the disk cache or rendered once. */
export async function loadIcons(root: string, id: string): Promise<Icon[]> {
  const lib = iconLibrary(id);
  if (!lib) throw new Error(`Unknown icon library "${id}". Known: ${ICON_LIBRARIES.map((l) => l.id).join(", ")}.`);
  const version = installedVersion(root, lib.package);
  if (!version) throw new Error(`${lib.package} isn't installed in this project. Install it first (install_library).`);
  const file = cacheFile(root, lib.id, version);
  // only the last set stays in memory: icon sets are large and rarely switched
  if (memo?.key === file) return memo.icons;
  const running = inflight.get(file);
  if (running) return running;
  const job = (async () => {
    let icons: Icon[] | null = null;
    try {
      icons = JSON.parse(fs.readFileSync(file, "utf8")) as Icon[];
    } catch {
      icons = await renderInWorker(root, lib.id);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(icons));
    }
    memo = { key: file, icons };
    return icons;
  })().finally(() => inflight.delete(file));
  inflight.set(file, job);
  return job;
}

async function renderInWorker(root: string, id: string): Promise<Icon[]> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const worker = [path.join(here, "icons-worker.js"), path.join(here, "..", "icons-worker.js")].find((p) => fs.existsSync(p));
  if (!worker) return renderIconSet(root, id);
  const { Worker } = await import("node:worker_threads");
  return new Promise((resolve, reject) => {
    const w = new Worker(worker, { workerData: { root, id } });
    w.once("message", (m: { ok: boolean; icons?: Icon[]; error?: string }) => (m.ok ? resolve(m.icons!) : reject(new Error(m.error))));
    w.once("error", reject);
    w.once("exit", (code) => code !== 0 && reject(new Error(`icons worker exited with ${code}`)));
  });
}

/**
 * Where `q`'s letters appear in order in `name` (`serch` in `search`): the
 * first matched index and the span covered, or null. Forgiving for typos.
 */
function subsequence(q: string, name: string): { start: number; span: number } | null {
  let i = 0;
  let start = -1;
  for (let j = 0; j < name.length && i < q.length; j++) {
    if (name[j] !== q[i]) continue;
    if (i === 0) start = j;
    i++;
    if (i === q.length) return { start, span: j - start + 1 };
  }
  return null;
}

/** Edit distance, or Infinity once it's clearly more than `max` (names are short). */
function distance(a: string, b: string, max = 2): number {
  if (Math.abs(a.length - b.length) > max) return Infinity;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    if (Math.min(...row) > max) return Infinity;
    prev = row;
  }
  return prev[b.length];
}

/**
 * Ranks icons for a query: exact name, prefix, a near-typo of the whole name,
 * substring; letters-in-order matches only fill in when there are few direct
 * matches, tightest first.
 */
export function searchIcons(icons: Icon[], query: string, limit = 200): { total: number; icons: Icon[] } {
  const q = query.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!q) return { total: icons.length, icons: icons.slice(0, limit) };
  const direct: { icon: Icon; score: number }[] = [];
  const fuzzy: { icon: Icon; score: number }[] = [];
  for (const icon of icons) {
    const name = icon.name.toLowerCase().replace(/^icon(?=[a-z0-9])/, "").replace(/icon$/, "");
    if (name === q) direct.push({ icon, score: 0 });
    else if (name.startsWith(q)) direct.push({ icon, score: 1 });
    // a typo of the whole name ("serch" → Search) beats the query appearing inside a longer name
    else if (q.length > 3 && distance(q, name) <= 2) direct.push({ icon, score: 1 + distance(q, name) / 4 });
    else if (name.includes(q)) direct.push({ icon, score: 2 });
    else if (q.length > 2) {
      const m = subsequence(q, name);
      if (m && m.span <= q.length * 2) fuzzy.push({ icon, score: (m.start === 0 ? 0 : 1000) + m.span * 10 + name.length / 100 });
    }
  }
  const byScore = (a: { icon: Icon; score: number }, b: { icon: Icon; score: number }) => a.score - b.score || a.icon.name.length - b.icon.name.length;
  direct.sort(byScore);
  fuzzy.sort(byScore);
  const ranked = direct.length >= 5 ? direct : [...direct, ...fuzzy];
  return { total: ranked.length, icons: ranked.slice(0, limit).map((s) => s.icon) };
}

/** Which icon libraries are installed, for the picker and agents. */
export function iconLibraries(root: string) {
  return ICON_LIBRARIES.map((l) => ({ id: l.id, label: l.label, package: l.package, from: l.from, homepage: l.homepage, version: installedVersion(root, l.package) }));
}
