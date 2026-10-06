import { execFile, spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { packageSpec } from "../cli/setup.js";
import { detectPm, addArgs, toolEnv, type Pm } from "../core/pm.js";

export interface Running {
  path: string;
  editorPort: number;
  appPort: number;
  proc: ChildProcess;
  status: "starting" | "ready" | "failed";
  error?: string;
  log: string[];
  startedAt: number;
}

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => srv.close(() => resolve(true)));
  });
}

async function freePort(from: number, taken: Set<number>): Promise<number> {
  for (let p = from; p < from + 200; p++) if (!taken.has(p) && (await portFree(p))) return p;
  throw new Error("No free port");
}

/**
 * Starts and stops `truecanvas dev` (which starts the project's `next dev`)
 * for each project opened in the hub. Closing a project frees its memory.
 */
export class Runner {
  readonly running = new Map<string, Running>();
  constructor(
    private cli: string,
    private onChange: () => void,
  ) {}

  private opening = new Map<string, Promise<Running>>();
  private ports: Promise<unknown> = Promise.resolve();

  /** Opens a project; concurrent calls for the same folder share one start. */
  open(dir: string): Promise<Running> {
    const existing = this.running.get(dir);
    if (existing && existing.status !== "failed") return Promise.resolve(existing);
    const pending = this.opening.get(dir);
    if (pending) return pending;
    const job = this.start(dir).finally(() => this.opening.delete(dir));
    this.opening.set(dir, job);
    return job;
  }

  /** Two ports, picked one project at a time so parallel opens never collide. */
  private allocatePorts(): Promise<[number, number]> {
    const next = this.ports.then(async () => {
      const taken = new Set([...this.running.values()].flatMap((r) => [r.editorPort, r.appPort]));
      const editorPort = await freePort(4810, taken);
      taken.add(editorPort);
      return [editorPort, await freePort(3010, taken)] as [number, number];
    });
    this.ports = next.catch(() => {});
    return next;
  }

  private async start(dir: string): Promise<Running> {
    if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error(`${dir} isn't there anymore (or has no package.json).`);
    const [editorPort, appPort] = await this.allocatePorts();
    const proc = spawn(process.execPath, [this.cli, "dev", "--no-open", "--port", String(editorPort), "--app", `http://localhost:${appPort}`], {
      cwd: dir,
      env: toolEnv({ FORCE_COLOR: "0", TRUECANVAS_HUB: "1" }),
      stdio: ["ignore", "pipe", "pipe"],
      // its own process group: closing the project also stops the next dev it started
      detached: process.platform !== "win32",
    });
    const run: Running = { path: dir, editorPort, appPort, proc, status: "starting", log: [], startedAt: Date.now() };
    this.running.set(dir, run);
    const capture = (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) if (line.trim()) run.log.push(line.replace(/\x1b\[[0-9;]*m/g, ""));
      if (run.log.length > 200) run.log.splice(0, run.log.length - 200);
    };
    proc.stdout!.on("data", capture);
    proc.stderr!.on("data", capture);
    proc.on("error", (err) => {
      run.status = "failed";
      run.error = err.message;
      this.onChange();
    });
    proc.on("exit", (code) => {
      if (this.running.get(dir) !== run) return;
      if (run.status === "starting" || code) {
        run.status = "failed";
        run.error = run.log.slice(-6).join("\n") || `exited with ${code}`;
      } else this.running.delete(dir);
      this.onChange();
    });
    this.onChange();
    // ready once the editor server answers
    const until = Date.now() + 60_000;
    while (Date.now() < until && run.status === "starting") {
      try {
        const res = await fetch(`http://127.0.0.1:${editorPort}/api/state`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) {
          run.status = "ready";
          break;
        }
      } catch {
        /* not up yet */
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    if (run.status === "starting") {
      run.status = "failed";
      run.error = "Truecanvas didn't start within a minute.";
      killTree(run.proc, "SIGTERM");
    }
    this.onChange();
    return run;
  }

  /** Stops a project and everything it started; resolves once it has exited (or after 5s). */
  close(dir: string): Promise<void> {
    const run = this.running.get(dir);
    if (!run) return Promise.resolve();
    this.running.delete(dir);
    this.onChange();
    if (run.proc.exitCode !== null || run.proc.signalCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const force = setTimeout(() => killTree(run.proc, "SIGKILL"), 4000);
      const done = setTimeout(resolve, 5000);
      run.proc.once("exit", () => {
        clearTimeout(force);
        clearTimeout(done);
        resolve();
      });
      killTree(run.proc, "SIGTERM");
    });
  }

  closeAll(): Promise<void> {
    return Promise.all([...this.running.keys()].map((dir) => this.close(dir))).then(() => {});
  }

  /** Resident memory (MB) of each project's process tree. */
  memory(): Promise<Record<string, number>> {
    return new Promise((resolve) => {
      execFile("ps", ["-eo", "pid=,ppid=,rss="], (err, out) => {
        if (err) return resolve({});
        const rows = out
          .trim()
          .split("\n")
          .map((l) => l.trim().split(/\s+/).map(Number));
        const kids = new Map<number, number[]>();
        const rss = new Map<number, number>();
        for (const [pid, ppid, kb] of rows) {
          rss.set(pid, kb);
          kids.set(ppid, [...(kids.get(ppid) ?? []), pid]);
        }
        const total = (pid: number): number => (rss.get(pid) ?? 0) + (kids.get(pid) ?? []).reduce((s, k) => s + total(k), 0);
        const outMap: Record<string, number> = {};
        for (const [dir, run] of this.running) if (run.proc.pid) outMap[dir] = Math.round(total(run.proc.pid) / 1024);
        resolve(outMap);
      });
    });
  }
}

/** Signals a project's whole process group (truecanvas dev, next dev and its workers). */
function killTree(proc: ChildProcess, signal: NodeJS.Signals) {
  try {
    if (process.platform !== "win32" && proc.pid) process.kill(-proc.pid, signal);
    else proc.kill(signal);
  } catch {
    proc.kill(signal);
  }
}

// ---------------------------------------------------------------------------
// Jobs: long tasks (install Truecanvas into a project, create a new app)
// ---------------------------------------------------------------------------

export interface Job {
  id: string;
  title: string;
  status: "running" | "done" | "failed";
  log: string[];
  result?: string;
}

const jobs = new Map<string, Job>();
let jobSeq = 0;

export function getJob(id: string) {
  return jobs.get(id);
}

/**
 * pnpm 10+ exits non-zero when *other* dependencies have unapproved build scripts
 * (ERR_PNPM_IGNORED_BUILDS), even though the install itself succeeded.
 */
async function install(job: Job, cmd: string, args: string[], cwd: string) {
  try {
    await run(job, cmd, args, cwd);
  } catch (err) {
    const ignoredBuilds = job.log.some((l) => l.includes("ERR_PNPM_IGNORED_BUILDS"));
    const installed = fs.existsSync(path.join(cwd, "node_modules", "truecanvas", "package.json"));
    if (!(ignoredBuilds && installed)) throw err;
    job.log.push("(pnpm only complained about other packages' build scripts; Truecanvas is installed, continuing)");
  }
}

function run(job: Job, cmd: string, args: string[], cwd: string): Promise<void> {
  job.log.push(`$ ${cmd} ${args.join(" ")}`);
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: toolEnv({ CI: "1", FORCE_COLOR: "0" }), stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32" });
    const capture = (c: Buffer) => {
      for (const line of c.toString().split("\n")) if (line.trim()) job.log.push(line.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, ""));
      if (job.log.length > 300) job.log.splice(0, job.log.length - 300);
    };
    p.stdout!.on("data", capture);
    p.stderr!.on("data", capture);
    p.on("error", reject);
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited with ${code}`))));
  });
}

function startJob(title: string, work: (job: Job) => Promise<string | void>): Job {
  const job: Job = { id: String(++jobSeq), title, status: "running", log: [] };
  jobs.set(job.id, job);
  work(job)
    .then((result) => {
      job.status = "done";
      if (result) job.result = result;
    })
    .catch((err) => {
      job.status = "failed";
      job.log.push(`✗ ${(err as Error).message}`);
    });
  return job;
}

/** The project's package manager (lockfile here or in a parent workspace), as a command. */
function packageManager(dir: string): { cmd: Pm; add: string[] } {
  const pm = detectPm(dir);
  return { cmd: pm, add: addArgs(pm, [], true) };
}

/** pnpm when it's installed (fast, small), else npm, which comes with Node. */
async function preferredPm(): Promise<Pm> {
  const { ok } = await capture("pnpm", ["--version"], os.homedir());
  return ok ? "pnpm" : "npm";
}

export function setupJob(dir: string, pkgDir: string, cli: string): Job {
  return startJob(`Set up ${path.basename(dir)}`, async (job) => {
    const pm = packageManager(dir);
    const source = await packageSpec(pkgDir, (cmd, args, cwd) => run(job, cmd, args, cwd));
    await install(job, pm.cmd, [...pm.add, source], dir);
    await run(job, process.execPath, [cli, "init"], dir);
    return dir;
  });
}

export function createJob(name: string, parent: string, pkgDir: string, cli: string): Job {
  const safe = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const parentDir = path.resolve(parent.replace(/^~(?=$|\/)/, os.homedir()));
  const dir = path.join(parentDir, safe);
  return startJob(`Create ${safe}`, async (job) => {
    if (!safe) throw new Error("Pick a project name.");
    if (fs.existsSync(dir)) throw new Error(`${dir} already exists.`);
    fs.mkdirSync(parentDir, { recursive: true });
    const pm = await preferredPm();
    await run(job, "npx", ["--yes", "create-next-app@latest", safe, "--ts", "--tailwind", "--app", "--eslint", "--no-src-dir", "--import-alias", "@/*", `--use-${pm}`, "--turbopack", "--yes"], parentDir);
    const source = await packageSpec(pkgDir, (cmd, args, cwd) => run(job, cmd, args, cwd));
    await install(job, pm, addArgs(pm, [source], true), dir);
    await run(job, process.execPath, [cli, "init"], dir);
    return dir;
  });
}

/** Output of a command (gh, git) or null when it fails. */
export function capture(cmd: string, args: string[], cwd: string): Promise<{ ok: boolean; out: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd, timeout: 60_000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, GH_PROMPT_DISABLED: "1", GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: err ? (stderr || err.message).trim() : stdout }),
    );
  });
}

/**
 * Clone a GitHub repo ("owner/name" through gh, or any git URL), install its
 * dependencies, and set Truecanvas up if the project doesn't have it yet.
 */
export function cloneJob(repo: string, parent: string, pkgDir: string, cli: string): Job {
  const parentDir = path.resolve(parent.replace(/^~(?=$|\/)/, os.homedir()));
  const name = repo.replace(/\.git$/, "").split(/[/:]/).pop() ?? "";
  const dir = path.join(parentDir, name);
  return startJob(`Clone ${name}`, async (job) => {
    if (!name || !/^[\w.-]+$/.test(name)) throw new Error("Pick a repository (owner/name or a git URL).");
    if (fs.existsSync(dir)) throw new Error(`${dir} already exists. Open it with Open folder instead.`);
    fs.mkdirSync(parentDir, { recursive: true });
    const url = /^(https?:|git@|ssh:|file:)/.test(repo);
    if (url) await run(job, "git", ["clone", repo, dir], parentDir);
    else await run(job, "gh", ["repo", "clone", repo, dir], parentDir);
    if (!fs.existsSync(path.join(dir, "package.json"))) throw new Error("Cloned, but there's no package.json at the root: Truecanvas needs a Next.js app.");
    const pm = packageManager(dir);
    await install(job, pm.cmd, ["install"], dir).catch(async (err) => {
      if (!fs.existsSync(path.join(dir, "node_modules"))) throw err;
    });
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf8"));
    if (!("truecanvas" in { ...pkg.dependencies, ...pkg.devDependencies })) {
      const source = await packageSpec(pkgDir, (cmd, args, cwd) => run(job, cmd, args, cwd));
      await install(job, pm.cmd, [...pm.add, source], dir);
      await run(job, process.execPath, [cli, "init"], dir);
    } else job.log.push("Truecanvas is already part of this project.");
    return dir;
  });
}
