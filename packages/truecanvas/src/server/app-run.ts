/*
 * Whether Truecanvas started the project's app (next dev or vite) itself, and
 * how far along it is, so the editor can say "starting" instead of "not
 * running" while the first compile is still going.
 */
export interface AppRun {
  /** external: not started by Truecanvas; starting: started, not answering yet; ready; failed: it exited */
  state: "external" | "starting" | "ready" | "failed";
  /** the last lines it printed, when it failed */
  log: string[];
}

export const appRun: AppRun = { state: "external", log: [] };
