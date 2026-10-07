import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { app } from "electron";

/*
 * Start Truecanvas at login, in the tray (opt-in). Linux has no login items:
 * an XDG autostart entry does it. macOS and Windows use the system's own.
 */

const entry = () => path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config"), "autostart", "truecanvas.desktop");

export function startsAtLogin(): boolean {
  if (process.platform === "linux") return fs.existsSync(entry());
  return app.getLoginItemSettings().openAtLogin;
}

export function setStartAtLogin(on: boolean) {
  if (process.platform !== "linux") {
    app.setLoginItemSettings({ openAtLogin: on, args: ["--hidden"] });
    return;
  }
  if (!on) {
    fs.rmSync(entry(), { force: true });
    return;
  }
  // the AppImage moves with the user's file: APPIMAGE is where it is now
  const exe = process.env.APPIMAGE ?? process.execPath;
  fs.mkdirSync(path.dirname(entry()), { recursive: true });
  fs.writeFileSync(
    entry(),
    `[Desktop Entry]
Type=Application
Name=Truecanvas
Comment=Design with your real React components
Exec="${exe.replace(/"/g, '\\"')}" --hidden
Terminal=false
X-GNOME-Autostart-enabled=true
`,
  );
}
