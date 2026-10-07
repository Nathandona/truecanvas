/*
 * The projects window (hub) as a library, for hosts that run it in their own
 * process: the desktop app. Built next to cli.js, so it finds the editor bundle.
 */
export { startHub, type HubNotice, type HubOptions } from "./server.js";
export { HUB_PORT, hubPort } from "./locate.js";
export { useNodeRuntime } from "../core/pm.js";
