import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { EditError } from "./edit.js";

/** Shown to the user as-is (400), like edit errors. */
export class GitError extends EditError {}

type RunOpts = { env?: Record<string, string>; input?: string | Buffer; /** exit code 1 still means success (diff --no-index) */ exit1?: boolean };

function git(cwd: string, args: string[], timeout = 30_000, opts: RunOpts = {}): Promise<string> {
  return run("git", cwd, args, timeout, opts);
}

function run(cmd: string, cwd: string, args: string[], timeout: number, opts: RunOpts = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      cmd,
      args,
      { cwd, timeout, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GH_PROMPT_DISABLED: "1", LC_ALL: "C", ...opts.env } },
      (err, stdout, stderr) => {
        if (err && opts.exit1 && (err as { code?: unknown }).code === 1) resolve(stdout);
        else if (err) {
          const missing = (err as NodeJS.ErrnoException).code === "ENOENT";
          reject(new GitError(missing ? `${cmd} isn't installed.` : (stderr || err.message).trim().split("\n").slice(-3).join(" ")));
        } else resolve(stdout);
      },
    );
    if (opts.input !== undefined) child.stdin?.end(opts.input);
  });
}

/**
 * Refs and branch names come from the editor and agents: they must never be
 * read as an option (`--output=…`) or carry shell-ish characters.
 */
export function safeRef(ref: string): string {
  if (!ref || ref.startsWith("-") || !/^[\w./~^@{}+-]+$/.test(ref) || ref.includes("..")) throw new GitError(`Invalid git ref "${ref}".`);
  return ref;
}

export interface GitFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked" | "conflicted";
  staged: boolean;
}

export interface GitStatus {
  repo: boolean;
  root: string | null;
  branch: string | null;
  /** no commits yet */
  unborn: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: GitFile[];
  user: string | null;
  /** main/master: the branch pull requests go into */
  defaultBranch: string | null;
  /** remote "origin" URL, if any */
  remote: string | null;
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

export interface GitCommit {
  hash: string;
  short: string;
  subject: string;
  author: string;
  at: number;
}

/** Thin wrapper over the git CLI for the editor's Git panel. */
export class Git {
  constructor(private cwd: string) {}

  async status(): Promise<GitStatus> {
    let root: string;
    try {
      root = (await git(this.cwd, ["rev-parse", "--show-toplevel"])).trim();
    } catch {
      return { repo: false, root: null, branch: null, unborn: false, upstream: null, ahead: 0, behind: 0, files: [], user: null, defaultBranch: null, remote: null };
    }
    // -z: NUL-separated and unquoted, so paths with spaces or accents come back as-is
    const out = await git(this.cwd, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all", "--", "."]);
    const s: GitStatus = { repo: true, root, branch: null, unborn: false, upstream: null, ahead: 0, behind: 0, files: [], user: null, defaultBranch: null, remote: null };
    const entries = out.split("\0");
    for (let i = 0; i < entries.length; i++) {
      const line = entries[i];
      if (line.startsWith("# branch.head ")) s.branch = line.slice(14) === "(detached)" ? null : line.slice(14);
      else if (line.startsWith("# branch.oid ")) s.unborn = line.slice(13) === "(initial)";
      else if (line.startsWith("# branch.upstream ")) s.upstream = line.slice(18);
      else if (line.startsWith("# branch.ab ")) {
        const m = /\+(\d+) -(\d+)/.exec(line);
        if (m) [s.ahead, s.behind] = [Number(m[1]), Number(m[2])];
      } else if (line.startsWith("1 ") || line.startsWith("2 ")) {
        const parts = line.split(" ");
        const xy = parts[1];
        // "2" (renamed/copied) has one more field, and the original path follows as its own entry
        const file = parts.slice(line.startsWith("2 ") ? 9 : 8).join(" ");
        if (line.startsWith("2 ")) i++;
        const code = xy.replace(".", "")[0] ?? "M";
        s.files.push({ path: this.rel(root, file), status: code === "A" ? "added" : code === "D" ? "deleted" : code === "R" ? "renamed" : "modified", staged: xy[0] !== "." });
      } else if (line.startsWith("u ")) {
        s.files.push({ path: this.rel(root, line.split(" ").slice(10).join(" ")), status: "conflicted", staged: false });
      } else if (line.startsWith("? ")) s.files.push({ path: this.rel(root, line.slice(2)), status: "untracked", staged: false });
    }
    s.user = (await git(this.cwd, ["config", "user.name"]).catch(() => "")).trim() || null;
    s.remote = (await git(this.cwd, ["remote", "get-url", "origin"]).catch(() => "")).trim() || null;
    s.defaultBranch = await this.defaultBranch();
    return s;
  }

  /** The branch PRs target: origin's HEAD, else a local main/master. */
  async defaultBranch(): Promise<string | null> {
    const head = (await git(this.cwd, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]).catch(() => "")).trim();
    if (head) return head.replace(/^origin\//, "");
    const { local } = await this.branches();
    return ["main", "master", "trunk", "develop"].find((b) => local.includes(b)) ?? null;
  }

  /** When the last commit was made (ms), or 0 with no commits. */
  async lastCommitAt(): Promise<number> {
    const out = await git(this.cwd, ["log", "-1", "--format=%ct"]).catch(() => "");
    return Number(out.trim() || 0) * 1000;
  }

  /** When a commit was made (ms). */
  async commitAt(ref: string): Promise<number> {
    const out = await git(this.cwd, ["log", "-1", "--format=%ct", safeRef(ref), "--"]).catch(() => "");
    return Number(out.trim() || 0) * 1000;
  }

  /** Commit where this branch left `base`. */
  async mergeBase(base: string): Promise<string | null> {
    safeRef(base);
    for (const ref of [`origin/${base}`, base]) {
      const out = await git(this.cwd, ["merge-base", ref, "HEAD"]).catch(() => "");
      if (out.trim()) return out.trim();
    }
    return null;
  }

  /** Files changed between a commit and HEAD, from the project root. */
  async changedSince(ref: string): Promise<string[]> {
    const out = await git(this.cwd, ["diff", "--name-only", "--relative", `${safeRef(ref)}...HEAD`, "--"]).catch(() => "");
    return out.split("\n").filter(Boolean);
  }

  /** Unified diff of these files against HEAD, including new files. */
  async diff(files: string[]): Promise<string> {
    if (!files.length) return "";
    const tracked = await git(this.cwd, ["diff", "--relative", "HEAD", "--", ...files]).catch(() => "");
    const untracked = (await git(this.cwd, ["ls-files", "--others", "--exclude-standard", "--", ...files]).catch(() => "")).split("\n").filter(Boolean);
    let out = tracked;
    for (const f of untracked) out += await git(this.cwd, ["diff", "--no-index", "--", "/dev/null", f], 30_000, { exit1: true }).catch(() => "");
    return out;
  }

  /**
   * Adds files to a side branch without touching the working tree or index
   * (used for PR screenshots), and pushes it. Returns the branch tip.
   */
  async commitToSideBranch(branch: string, files: { path: string; data: Buffer }[], message: string): Promise<void> {
    safeRef(branch);
    const tip = (await git(this.cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]).catch(() => "")).trim() || (await git(this.cwd, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`]).catch(() => "")).trim();
    const os = await import("node:os");
    const fs = await import("node:fs");
    const index = path.join(os.tmpdir(), `truecanvas-index-${process.pid}-${Date.now()}`);
    const env = { GIT_INDEX_FILE: index };
    try {
      if (tip) await git(this.cwd, ["read-tree", tip], 30_000, { env });
      else await git(this.cwd, ["read-tree", "--empty"], 30_000, { env });
      for (const f of files) {
        const blob = (await git(this.cwd, ["hash-object", "-w", "--stdin"], 30_000, { input: f.data })).trim();
        await git(this.cwd, ["update-index", "--add", "--cacheinfo", `100644,${blob},${f.path}`], 30_000, { env });
      }
      const tree = (await git(this.cwd, ["write-tree"], 30_000, { env })).trim();
      const commit = (await git(this.cwd, ["commit-tree", tree, ...(tip ? ["-p", tip] : []), "-m", message])).trim();
      await git(this.cwd, ["update-ref", `refs/heads/${branch}`, commit]);
      await git(this.cwd, ["push", "origin", `refs/heads/${branch}:refs/heads/${branch}`], 120_000);
    } finally {
      fs.rmSync(index, { force: true });
    }
  }

  // ---------- GitHub (gh CLI) ----------

  /** owner/name of the GitHub repo, if origin is on GitHub and gh is set up. */
  async githubRepo(): Promise<string | null> {
    const out = await run("gh", this.cwd, ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], 20_000).catch(() => "");
    return out.trim() || null;
  }

  /** The open (or latest) pull request of the current branch. */
  async pullRequest(): Promise<PullRequest | null> {
    const out = await run("gh", this.cwd, ["pr", "view", "--json", "number,url,title,state,isDraft,reviewDecision,statusCheckRollup"], 20_000).catch(() => "");
    if (!out.trim()) return null;
    const pr = JSON.parse(out) as {
      number: number;
      url: string;
      title: string;
      state: PullRequest["state"];
      isDraft: boolean;
      reviewDecision: string;
      statusCheckRollup: { conclusion?: string; state?: string; status?: string }[] | null;
    };
    const checks = { passed: 0, failed: 0, pending: 0 };
    for (const c of pr.statusCheckRollup ?? []) {
      const v = (c.conclusion || c.state || c.status || "").toUpperCase();
      if (["SUCCESS", "NEUTRAL", "SKIPPED"].includes(v)) checks.passed++;
      else if (["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED"].includes(v)) checks.failed++;
      else checks.pending++;
    }
    return { number: pr.number, url: pr.url, title: pr.title, state: pr.state, draft: pr.isDraft, review: (pr.reviewDecision || null) as PullRequest["review"], checks };
  }

  async createPullRequest(opts: { title: string; body: string; base: string; draft?: boolean }): Promise<string> {
    const out = await run("gh", this.cwd, ["pr", "create", "--title", opts.title, "--body-file", "-", "--base", safeRef(opts.base), ...(opts.draft ? ["--draft"] : [])], 120_000, { input: opts.body });
    return out.trim().split("\n").pop() ?? "";
  }

  /** Creates a GitHub repo for this project and pushes it (gh repo create). */
  async publish(name: string, isPrivate: boolean): Promise<string> {
    if (!/^[\w.-]+$/.test(name)) throw new GitError("Invalid repository name.");
    await run("gh", this.cwd, ["repo", "create", name, isPrivate ? "--private" : "--public", "--source", ".", "--remote", "origin", "--push"], 180_000);
    return (await git(this.cwd, ["remote", "get-url", "origin"])).trim();
  }

  /** git reports paths from the repo root; we show them from the project root. */
  private rel(root: string, file: string) {
    return path.relative(this.realCwd(), path.join(root, file));
  }

  /**
   * The project folder as git sees it: git reports real paths, so a folder
   * reached through a symlink (macOS /var → /private/var) must be resolved too.
   */
  private realCwd(): string {
    try {
      return fs.realpathSync(this.cwd);
    } catch {
      return this.cwd;
    }
  }

  async branches(): Promise<{ current: string | null; local: string[]; remote: string[] }> {
    // full ref names: "design/home" is a local branch, "origin/main" a remote one
    const out = await git(this.cwd, ["branch", "-a", "--format=%(refname)%09%(HEAD)"]).catch(() => "");
    const local: string[] = [];
    const remote: string[] = [];
    let current: string | null = null;
    for (const line of out.split("\n").filter(Boolean)) {
      const [ref, head] = line.split("\t");
      // the PR screenshots branch isn't a branch anyone works on
      if (ref.endsWith("/HEAD") || ref.endsWith("/truecanvas-previews")) continue;
      if (ref.startsWith("refs/heads/")) {
        const name = ref.slice("refs/heads/".length);
        if (head === "*") current = name;
        local.push(name);
      } else if (ref.startsWith("refs/remotes/")) remote.push(ref.slice("refs/remotes/".length));
    }
    return { current, local, remote };
  }

  /** Commits that touched these paths (newest first). */
  async log(paths: string[], limit = 30): Promise<GitCommit[]> {
    const out = await git(this.cwd, ["log", `-n${limit}`, "--format=%H%x09%h%x09%s%x09%an%x09%ct", "--", ...paths]).catch(() => "");
    return out
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        const [hash, short, subject, author, at] = l.split("\t");
        return { hash, short, subject, author, at: Number(at) * 1000 };
      });
  }

  /** A file's content at a ref, or null if it doesn't exist there. */
  async show(ref: string, file: string): Promise<string | null> {
    const root = (await git(this.cwd, ["rev-parse", "--show-toplevel"])).trim();
    const inRepo = path.relative(root, path.join(this.realCwd(), file)).split(path.sep).join("/");
    return git(this.cwd, ["show", `${safeRef(ref)}:${inRepo}`, "--"]).catch(() => null);
  }

  async commit(message: string, files: string[]): Promise<string> {
    if (!message.trim()) throw new GitError("Write a commit message.");
    if (!files.length) throw new GitError("Nothing to commit.");
    await git(this.cwd, ["add", "--all", "--", ...files]);
    await git(this.cwd, ["commit", "-m", message.trim(), "--", ...files]);
    return (await git(this.cwd, ["rev-parse", "--short", "HEAD"])).trim();
  }

  async push(): Promise<void> {
    const s = await this.status();
    if (s.upstream) await git(this.cwd, ["push"], 120_000);
    else await git(this.cwd, ["push", "-u", "origin", "HEAD"], 120_000);
  }

  async pull(): Promise<void> {
    await git(this.cwd, ["pull", "--ff-only"], 120_000);
  }

  async fetch(): Promise<void> {
    await git(this.cwd, ["fetch", "--quiet"], 60_000).catch(() => {});
  }

  async switch(branch: string, create = false): Promise<void> {
    safeRef(branch);
    await git(this.cwd, create ? ["switch", "-c", branch] : ["switch", branch]);
  }
}
