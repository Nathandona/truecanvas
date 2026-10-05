import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff9466"/><stop offset="1" stop-color="#ea6a3c"/></linearGradient>
    <linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".08" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity=".22"/></filter>
  </defs>
  <g filter="url(#sh)">
    <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#bg)"/>
    <rect x="100" y="100" width="824" height="824" rx="190" fill="url(#hl)"/>
  </g>
  <path fill="#f6f5f1" fill-rule="evenodd" d="M236 236h552v168H236z M428 316h168v472H428z"/>
</svg>
`;

const data = () => process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");

/**
 * Installs a desktop launcher (GNOME/KDE app grid). It starts the hub in the
 * background if needed and opens it in its own app window (Chromium --app).
 */
export function installDesktop(cli: string, port: number) {
  const dir = path.join(data(), "truecanvas");
  fs.mkdirSync(dir, { recursive: true });
  const icon = path.join(dir, "icon.svg");
  fs.writeFileSync(icon, ICON);

  const launcher = path.join(dir, "launch.sh");
  const url = `http://localhost:${port}`;
  fs.writeFileSync(
    launcher,
    `#!/bin/sh
# Truecanvas launcher: start the hub if needed, then open its window.
NODE=${JSON.stringify(process.execPath)}
CLI=${JSON.stringify(cli)}
URL=${JSON.stringify(url)}
LOG="\${XDG_STATE_HOME:-$HOME/.local/state}/truecanvas-hub.log"
# apps started from the desktop don't get your shell's PATH: next, pnpm and npx need it
export PATH=${JSON.stringify([path.dirname(process.execPath), ...(process.env.PATH ?? "").split(":")].filter((p, i, a) => p && a.indexOf(p) === i).join(":"))}
mkdir -p "$(dirname "$LOG")"

if ! curl -sf "$URL/api/hub/state" >/dev/null 2>&1; then
  nohup "$NODE" "$CLI" hub --port ${port} >"$LOG" 2>&1 &
  i=0
  while [ $i -lt 60 ] && ! curl -sf "$URL/api/hub/state" >/dev/null 2>&1; do sleep 0.25; i=$((i+1)); done
fi

PROFILE=${JSON.stringify(path.join(dir, "window"))}
for b in google-chrome google-chrome-stable chromium-browser chromium brave-browser microsoft-edge; do
  if command -v "$b" >/dev/null 2>&1; then
    exec "$b" --app="$URL" --class=Truecanvas --user-data-dir="$PROFILE" --no-first-run --no-default-browser-check
  fi
done
exec xdg-open "$URL"
`,
    { mode: 0o755 },
  );

  const apps = path.join(data(), "applications");
  fs.mkdirSync(apps, { recursive: true });
  const desktop = path.join(apps, "truecanvas.desktop");
  fs.writeFileSync(
    desktop,
    `[Desktop Entry]
Type=Application
Name=Truecanvas
GenericName=Design canvas
Comment=Design with your real React components
Exec=${launcher}
Icon=${icon}
Terminal=false
Categories=Graphics;
Keywords=design;canvas;react;figma;mcp;
StartupWMClass=Truecanvas
StartupNotify=true
`,
  );
  // a `truecanvas` command in ~/.local/bin (on PATH by default on Fedora/Ubuntu)
  let command: string | null = path.join(os.homedir(), ".local", "bin", "truecanvas");
  const ours = !fs.existsSync(command) || fs.readFileSync(command, "utf8").includes("# truecanvas wrapper");
  if (ours) {
    fs.mkdirSync(path.dirname(command), { recursive: true });
    fs.writeFileSync(command, `#!/bin/sh\n# truecanvas wrapper (installed by \`truecanvas desktop\`)\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(cli)} "$@"\n`, { mode: 0o755 });
  } else command = null;
  return { desktop, launcher, icon, command };
}

export function launcherPath(): string | null {
  const p = path.join(data(), "truecanvas", "launch.sh");
  return fs.existsSync(p) ? p : null;
}

export function uninstallDesktop() {
  const removed: string[] = [];
  const cmd = path.join(os.homedir(), ".local", "bin", "truecanvas");
  if (fs.existsSync(cmd) && fs.readFileSync(cmd, "utf8").includes("# truecanvas wrapper")) {
    fs.rmSync(cmd);
    removed.push(cmd);
  }
  for (const f of [path.join(data(), "applications", "truecanvas.desktop"), path.join(data(), "truecanvas")]) {
    if (fs.existsSync(f)) {
      fs.rmSync(f, { recursive: true, force: true });
      removed.push(f);
    }
  }
  return removed;
}
