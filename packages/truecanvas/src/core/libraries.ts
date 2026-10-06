import { iconLibraries, iconLibrary } from "./icons.js";
import { addArgs, detectPm, run } from "./pm.js";
import { shadcnAdd, shadcnRegistry, shadcnStatus } from "./shadcn.js";
import { EditError } from "./edit.js";

/*
 * Libraries the user can bring into a project from the canvas: icon sets
 * (installed as packages) and shadcn/ui components (copied in as source).
 * The editor's Libraries dialog and the MCP tools both go through here.
 */

export function libraryState(root: string) {
  return { packageManager: detectPm(root), icons: iconLibraries(root), shadcn: shadcnStatus(root) };
}

// installs touch package.json and the lockfile: one at a time
let lock: Promise<unknown> = Promise.resolve();
function exclusive<T>(job: () => Promise<T>): Promise<T> {
  const next = lock.then(job, job);
  lock = next.catch(() => {});
  return next;
}

/** Installs a known icon library with the project's package manager. */
export function installIconLibrary(root: string, id: string): Promise<{ ok: boolean; out: string; package: string }> {
  const lib = iconLibrary(id);
  if (!lib) throw new EditError(`Unknown icon library "${id}". Known: ${iconLibraries(root).map((l) => l.id).join(", ")}.`);
  return exclusive(async () => {
    const pm = detectPm(root);
    const res = await run(pm, addArgs(pm, [lib.package]), root);
    return { ...res, package: lib.package };
  });
}

/** Adds shadcn/ui components (setting shadcn up first when needed). */
export function addShadcnComponents(root: string, names: string[]) {
  if (!names.length) throw new EditError("Name at least one component, e.g. button.");
  return exclusive(() => shadcnAdd(root, names));
}

export { shadcnRegistry };
