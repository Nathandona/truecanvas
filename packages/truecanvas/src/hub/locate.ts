import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/*
 * Where the hub listens. It's port 4800 (agents' MCP URL points there), but
 * the desktop app picks another port when something else holds 4800, and
 * writes it here so `truecanvas open` and friends still find the window.
 */

export const HUB_PORT = 4800;

function stateDir(): string {
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "truecanvas");
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "truecanvas");
  return path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "truecanvas");
}

export const hubFile = () => path.join(stateDir(), "hub.json");

export function writeHubFile(port: number) {
  try {
    fs.mkdirSync(stateDir(), { recursive: true });
    fs.writeFileSync(hubFile(), JSON.stringify({ port, pid: process.pid }));
  } catch {
    // only a convenience: the default port still works
  }
}

/** Removes the file, if it's ours. */
export function removeHubFile() {
  try {
    const saved = JSON.parse(fs.readFileSync(hubFile(), "utf8")) as { pid?: number };
    if (saved.pid === process.pid) fs.rmSync(hubFile());
  } catch {
    // nothing to remove
  }
}

/** The port of the running hub: the one it wrote down while its process is alive, else 4800. */
export function hubPort(): number {
  try {
    const saved = JSON.parse(fs.readFileSync(hubFile(), "utf8")) as { port?: number; pid?: number };
    if (saved.port && saved.pid) {
      process.kill(saved.pid, 0);
      return saved.port;
    }
  } catch {
    // no file, or its process is gone
  }
  return HUB_PORT;
}
