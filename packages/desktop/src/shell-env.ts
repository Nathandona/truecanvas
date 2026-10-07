import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/*
 * Apps started from a desktop (the app grid, at login) don't get the PATH of
 * the user's shell, where node, pnpm and npm usually live (nvm, fnm, volta,
 * Homebrew…). Ask a login shell for it, once, at startup.
 */

const MARK = "__TRUECANVAS_PATH__";

/** This process's environment without Electron's or the AppImage's own variables, which must not reach the user's tools. */
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("ELECTRON_") || key === "CHROME_DESKTOP" || key === "GOOGLE_API_KEY") delete env[key];
  if (process.env.APPDIR) for (const key of ["APPDIR", "APPIMAGE", "ARGV0", "OWD", "LD_LIBRARY_PATH", "LD_PRELOAD", "PYTHONHOME", "PYTHONPATH", "PERLLIB", "GSETTINGS_SCHEMA_DIR", "QT_PLUGIN_PATH"]) delete env[key];
  return env;
}

function loginShellPath(env: NodeJS.ProcessEnv): string | null {
  if (process.platform === "win32") return null;
  const shell = env.SHELL || (process.platform === "darwin" ? "/bin/zsh" : "/bin/bash");
  // fish keeps PATH as a list
  const print = path.basename(shell) === "fish" ? `printf '${MARK}%s${MARK}' (string join : $PATH)` : `printf '${MARK}%s${MARK}' "$PATH"`;
  try {
    const out = execFileSync(shell, ["-ilc", print], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "ignore"],
      // keep shell plugins from prompting or updating themselves
      env: { ...env, DISABLE_AUTO_UPDATE: "true", ZSH_TMUX_AUTOSTART: "false" },
    });
    const found = new RegExp(`${MARK}(.*?)${MARK}`, "s").exec(out);
    return found?.[1] || null;
  } catch {
    return null;
  }
}

function which(cmd: string, dirs: string[]): string | null {
  const names = process.platform === "win32" ? [`${cmd}.exe`, `${cmd}.cmd`] : [cmd];
  for (const dir of dirs) {
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        fs.accessSync(file, fs.constants.X_OK);
        if (fs.statSync(file).isFile()) return file;
      } catch {
        // not here
      }
    }
  }
  return null;
}

export interface UserRuntime {
  /** the user's Node, or null when there is none */
  node: string | null;
  /** the environment projects and tools run with: the login shell's PATH, nothing from Electron or the AppImage */
  env: NodeJS.ProcessEnv;
  /** whether the login shell answered (else only the launcher's PATH was searched) */
  fromShell: boolean;
  /** what's missing, said for the window's banner */
  problem: string | null;
}

export function userRuntime(): UserRuntime {
  const env = cleanEnv();
  const shellPath = loginShellPath(env);
  const dirs = [...(shellPath ?? "").split(path.delimiter), ...(env.PATH ?? "").split(path.delimiter)].filter((d, i, all) => d && all.indexOf(d) === i);
  env.PATH = dirs.join(path.delimiter);
  // the binary itself: version managers' shims (fnm's per-shell folders) can vanish while the app runs
  const found = which("node", dirs);
  const node = found ? fs.realpathSync(found) : null;
  const pm = which("pnpm", dirs) ?? which("npm", dirs);
  const problem = !node
    ? "Node.js isn't installed (or isn't on your shell's PATH). Truecanvas runs your projects with your own Node: install it from nodejs.org, then restart Truecanvas."
    : !pm
      ? "npm or pnpm wasn't found on your shell's PATH. Setting projects up needs one of them."
      : null;
  return { node, env, fromShell: !!shellPath, problem };
}
