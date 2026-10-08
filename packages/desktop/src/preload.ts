import { contextBridge, ipcRenderer } from "electron";

/*
 * What the window can ask of the desktop app. The projects window works the
 * same in a browser; it checks for `truecanvasDesktop` to show app-only actions.
 */
contextBridge.exposeInMainWorld("truecanvasDesktop", {
  version: process.argv.find((a) => a.startsWith("--truecanvas-version="))?.split("=")[1] ?? "",
  /** check GitHub releases now; the tray and a notification say what happened */
  checkForUpdates: (): Promise<string> => ipcRenderer.invoke("truecanvas:check-updates"),
  /** where the app's update is: idle, checking, downloading (percent), ready (version), latest, error */
  updateState: (): Promise<{ state: string; version?: string; percent?: number }> => ipcRenderer.invoke("truecanvas:update-state"),
  onUpdate: (cb: (u: { state: string; version?: string; percent?: number }) => void) => {
    const listener = (_: unknown, u: { state: string; version?: string; percent?: number }) => cb(u);
    ipcRenderer.on("truecanvas:update", listener);
    return () => ipcRenderer.removeListener("truecanvas:update", listener);
  },
  /** stops the projects, installs the downloaded version and reopens */
  restartToUpdate: (): Promise<void> => ipcRenderer.invoke("truecanvas:restart-to-update"),
  /** start or stop a live session for the active project's open canvas: its running sessions after */
  liveSession: (): Promise<{ canvas: string; status: string; url: string }[]> => ipcRenderer.invoke("truecanvas:live-session"),
});
