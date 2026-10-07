import { contextBridge, ipcRenderer } from "electron";

/*
 * What the window can ask of the desktop app. The projects window works the
 * same in a browser; it checks for `truecanvasDesktop` to show app-only actions.
 */
contextBridge.exposeInMainWorld("truecanvasDesktop", {
  version: process.argv.find((a) => a.startsWith("--truecanvas-version="))?.split("=")[1] ?? "",
  /** start or stop a live session for the active project's open canvas: its running sessions after */
  liveSession: (): Promise<{ canvas: string; status: string; url: string }[]> => ipcRenderer.invoke("truecanvas:live-session"),
});
