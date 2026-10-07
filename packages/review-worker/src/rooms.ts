import { requestHeaders } from "truecanvas/share";
import type { ReviewEnv } from "./env";

/** The link's room (room.ts): one Durable Object per link. */
const room = (env: ReviewEnv, slug: string) => env.ROOM.get(env.ROOM.idFromName(slug));

/** Someone joins the room, once the Worker has checked they may: a viewer, or the studio's Truecanvas as host. */
export function joinRoom(env: ReviewEnv, slug: string, who: { name: string; kind: "client" | "studio"; route?: string }, host: boolean): Promise<Response> {
  return room(env, slug).fetch(`https://room/${host ? "host" : "join"}`, { headers: { upgrade: "websocket", "x-tc-who": JSON.stringify(who) } });
}

/** Tell everyone in the room (the link's comments changed, say). Best effort: the poll catches up. */
export async function notifyRoom(env: ReviewEnv, slug: string, event: { t: string; [k: string]: unknown }): Promise<void> {
  try {
    await room(env, slug).fetch("https://room/notify", { method: "POST", body: JSON.stringify(event) });
  } catch (err) {
    console.error("room notify", err);
  }
}

export async function roomState(env: ReviewEnv, slug: string): Promise<unknown> {
  return (await room(env, slug).fetch("https://room/state")).json();
}

/**
 * A viewer's request for the studio's app, during a live session: on to the
 * room, which tunnels it to the host. Only the app's path and the headers the
 * app may see go along.
 */
export function tunnel(env: ReviewEnv, slug: string, req: Request, path: string): Promise<Response> {
  const headers = new Headers({ "x-tc-headers": JSON.stringify(requestHeaders(req.headers)) });
  const upgrade = req.headers.get("upgrade");
  if (upgrade) {
    headers.set("upgrade", upgrade);
    const protocol = req.headers.get("sec-websocket-protocol");
    if (protocol) headers.set("sec-websocket-protocol", protocol);
  }
  return room(env, slug).fetch(`https://room/tunnel${path}`, {
    method: req.method,
    headers,
    body: req.method === "POST" ? req.body : undefined,
  });
}
