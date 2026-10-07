import { DurableObject } from "cloudflare:workers";
import { CHUNK, decodeFrame, encodeFrame, type TunnelHeader } from "truecanvas/share";
import type { ReviewEnv } from "./env";

/*
 * A link's room: one Durable Object per link, holding everyone looking at it
 * through WebSockets (hibernation API, so an idle room costs nothing).
 *
 * - Presence: each participant (viewers, and the studio's Truecanvas when a
 *   session runs) has a name, a kind and a color; cursors are broadcast in
 *   canvas coordinates.
 * - Comments: the Worker tells the room when a link's comments change; the
 *   room tells everyone, so viewers and Truecanvas update right away.
 * - Live session: while the studio's Truecanvas is connected as the host,
 *   viewers' requests to the link's session host are tunneled to it (frames
 *   in wire.ts) and it answers from the project's dev server. Its HMR
 *   WebSockets travel as sub-streams, so frames update as the studio edits.
 *
 * Only the Worker reaches the room: it checks access first and says who is
 * joining in the x-tc-who header.
 */

export interface Person {
  id: string;
  name: string;
  kind: "client" | "studio";
  color: string;
}

type Attachment = (Person & { host: boolean; route?: string }) | { sub: string };

interface Pending {
  resolve: (res: Response) => void;
  writer: WritableStreamDefaultWriter<Uint8Array> | null;
  timer: ReturnType<typeof setTimeout> | null;
}

/** A tunneled request waits this long for the host's first answer. */
const ANSWER_TIMEOUT = 30_000;
/** Request bodies (form posts, server actions) the tunnel carries. */
const MAX_BODY = 10 * 1024 * 1024;
/** A participant's cursor is relayed at most this often. */
const CURSOR_EVERY = 45;
const MAX_TEXT = 4096;

const COLORS = ["#ea6a3c", "#3b82f6", "#16a34a", "#9333ea", "#db2777", "#0891b2", "#ca8a04", "#4f46e5", "#dc2626", "#059669"];

export class Room extends DurableObject<ReviewEnv> {
  private pending = new Map<string, Pending>();
  private lastCursor = new WeakMap<WebSocket, number>();
  private seq = 0;

  constructor(ctx: DurableObjectState, env: ReviewEnv) {
    super(ctx, env);
    // keep-alives get their answer without waking the room
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/join" || url.pathname === "/host") return this.join(req, url.pathname === "/host");
    if (url.pathname === "/notify" && req.method === "POST") {
      const event = (await req.json().catch(() => null)) as { t?: string } | null;
      if (event?.t) this.broadcast(event);
      return new Response("ok");
    }
    if (url.pathname === "/state") return Response.json(this.state());
    if (url.pathname.startsWith("/tunnel/")) return this.tunnel(req, url.pathname.slice("/tunnel".length) + url.search);
    return new Response("Not found", { status: 404 });
  }

  // ---------- participants ----------

  private join(req: Request, host: boolean): Response {
    if (req.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket", { status: 426 });
    let who: { name?: string; kind?: string; route?: string };
    try {
      who = JSON.parse(req.headers.get("x-tc-who") ?? "{}");
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const id = crypto.randomUUID().replace(/-/g, "").slice(0, 10);
    const person: Person = { id, name: String(who.name || "Guest").slice(0, 60), kind: who.kind === "studio" ? "studio" : "client", color: colorOf(id) };
    if (host) {
      // one host per link: a new session takes over (the old one is told why)
      for (const old of this.ctx.getWebSockets("host")) safeClose(old, 4000, "Another session took over");
      this.failAll("The session moved to another Truecanvas.");
    }
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server, host ? ["p", "host"] : ["p"]);
    const route = host && typeof who.route === "string" && /^\/[\w\-./]*$/.test(who.route) ? who.route : undefined;
    server.serializeAttachment({ ...person, host, ...(route ? { route } : {}) } satisfies Attachment);
    server.send(JSON.stringify({ t: "hello", you: person, ...this.state() }));
    this.broadcast({ t: "join", person }, server);
    if (host) this.broadcast({ t: "state", live: true, route: route ?? null }, server);
    return new Response(null, { status: 101, webSocket: client });
  }

  private people(except?: WebSocket): Person[] {
    const out: Person[] = [];
    for (const ws of this.ctx.getWebSockets("p")) {
      if (ws === except || ws.readyState !== WebSocket.OPEN) continue;
      const a = ws.deserializeAttachment() as Attachment | null;
      if (a && "id" in a) out.push({ id: a.id, name: a.name, kind: a.kind, color: a.color });
    }
    return out;
  }

  private host(except?: WebSocket): WebSocket | null {
    return this.ctx.getWebSockets("host").find((ws) => ws !== except && ws.readyState === WebSocket.OPEN) ?? null;
  }

  private state(except?: WebSocket) {
    const host = this.host(except);
    const a = host?.deserializeAttachment() as Attachment | null;
    return { live: !!host, route: a && "route" in a ? (a.route ?? null) : null, people: this.people(except) };
  }

  private broadcast(event: unknown, except?: WebSocket) {
    const data = JSON.stringify(event);
    for (const ws of this.ctx.getWebSockets("p")) {
      if (ws === except) continue;
      try {
        ws.send(data);
      } catch {
        // closing: its close handler tidies up
      }
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const a = ws.deserializeAttachment() as Attachment | null;
    if (!a) return;
    // a viewer's HMR socket: on to the host
    if ("sub" in a) {
      const host = this.host();
      if (!host) return safeClose(ws, 1012, "The session ended");
      const payload = typeof message === "string" ? new TextEncoder().encode(message) : new Uint8Array(message);
      host.send(encodeFrame({ t: "ws-msg", id: a.sub, text: typeof message === "string" }, payload));
      return;
    }
    if (typeof message !== "string") {
      // tunnel frames only come from the host
      if (a.host) await this.fromHost(message);
      return;
    }
    if (message.length > MAX_TEXT) return;
    let msg: { t?: string; x?: unknown; y?: unknown };
    try {
      msg = JSON.parse(message);
    } catch {
      return;
    }
    if (msg.t === "cursor") {
      const now = Date.now();
      if (now - (this.lastCursor.get(ws) ?? 0) < CURSOR_EVERY) return;
      this.lastCursor.set(ws, now);
      const on = typeof msg.x === "number" && typeof msg.y === "number" && Number.isFinite(msg.x) && Number.isFinite(msg.y);
      this.broadcast({ t: "cursor", id: a.id, x: on ? Math.round(msg.x as number) : null, y: on ? Math.round(msg.y as number) : null }, ws);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.closed(ws, code, reason);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.closed(ws, 1011, "error");
  }

  private closed(ws: WebSocket, code: number, reason: string) {
    const a = ws.deserializeAttachment() as Attachment | null;
    safeClose(ws, code === 1005 || code === 1006 ? 1000 : code, reason);
    if (!a) return;
    if ("sub" in a) {
      this.host()?.send(encodeFrame({ t: "ws-close", id: a.sub, code: 1000, reason: "" }));
      return;
    }
    this.broadcast({ t: "leave", id: a.id }, ws);
    if (a.host && !this.host(ws)) {
      // the studio left: viewers go back to the published version
      this.failAll("The studio's session ended.");
      for (const sub of this.ctx.getWebSockets("sub")) safeClose(sub, 1012, "The session ended");
      this.broadcast({ t: "state", live: false, route: null }, ws);
    }
  }

  // ---------- the tunnel ----------

  private async tunnel(req: Request, path: string): Promise<Response> {
    const host = this.host();
    if (!host) return new Response("The studio isn't in a live session right now.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8", "retry-after": "5" } });
    const headers = JSON.parse(req.headers.get("x-tc-headers") ?? "[]") as [string, string][];

    if (req.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const protocols = (req.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim())
        .filter(Boolean);
      const id = `w${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server, ["sub", `sub:${id}`]);
      server.serializeAttachment({ sub: id } satisfies Attachment);
      host.send(encodeFrame({ t: "ws-open", id, path, headers, protocols }));
      // the browser needs its subprotocol echoed (Vite's HMR asks for one)
      return new Response(null, { status: 101, webSocket: client, headers: protocols[0] ? { "sec-websocket-protocol": protocols[0] } : {} });
    }

    if (!["GET", "HEAD", "POST"].includes(req.method)) return new Response("Method not allowed", { status: 405 });
    const id = `r${++this.seq}-${Date.now().toString(36)}`;
    const hasBody = req.method === "POST" && !!req.body;
    const answer = new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve(new Response("The studio's app didn't answer in time.", { status: 504, headers: { "content-type": "text/plain; charset=utf-8" } }));
      }, ANSWER_TIMEOUT);
      this.pending.set(id, { resolve, writer: null, timer });
    });
    host.send(encodeFrame({ t: "req", id, method: req.method, path, headers, body: hasBody }));
    if (hasBody) {
      let sent = 0;
      const reader = req.body!.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        sent += value.length;
        if (sent > MAX_BODY) {
          host.send(encodeFrame({ t: "req-abort", id }));
          this.settle(id, new Response("Request too large for a live session.", { status: 413 }));
          return answer;
        }
        for (let i = 0; i < value.length; i += CHUNK) host.send(encodeFrame({ t: "req-body", id }, value.subarray(i, i + CHUNK)));
      }
      host.send(encodeFrame({ t: "req-end", id }));
    }
    return answer;
  }

  private settle(id: string, res: Response) {
    const p = this.pending.get(id);
    if (!p) return;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    p.resolve(res);
  }

  /** A tunnel frame from the host: an answer to a request, or a sub-stream's traffic. */
  private async fromHost(data: ArrayBuffer) {
    let frame: { header: TunnelHeader; payload: Uint8Array };
    try {
      frame = decodeFrame(data);
    } catch {
      return;
    }
    const h = frame.header;
    switch (h.t) {
      case "res": {
        const p = this.pending.get(h.id);
        if (!p || p.writer) return;
        const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
        p.writer = writable.getWriter();
        const headers = new Headers();
        for (const [k, v] of h.headers) {
          try {
            headers.append(k, v);
          } catch {
            // a header Workers won't set
          }
        }
        // work in progress: never indexed
        headers.set("x-robots-tag", "noindex, nofollow");
        const nullBody = h.status === 204 || h.status === 304 || (h.status >= 100 && h.status < 200);
        this.settle(h.id, new Response(nullBody ? null : readable, { status: h.status, headers }));
        if (nullBody) {
          this.pending.delete(h.id);
          void p.writer.close().catch(() => {});
        }
        return;
      }
      case "res-body": {
        const p = this.pending.get(h.id);
        if (!p?.writer) return;
        try {
          await p.writer.write(frame.payload.slice());
        } catch {
          this.pending.delete(h.id);
          this.host()?.send(encodeFrame({ t: "req-abort", id: h.id }));
        }
        return;
      }
      case "res-end": {
        const p = this.pending.get(h.id);
        this.pending.delete(h.id);
        await p?.writer?.close().catch(() => {});
        return;
      }
      case "res-error": {
        const p = this.pending.get(h.id);
        if (!p) return;
        this.pending.delete(h.id);
        if (p.writer) await p.writer.abort(h.message).catch(() => {});
        else this.settle(h.id, new Response(`The studio's app failed: ${h.message}`, { status: 502, headers: { "content-type": "text/plain; charset=utf-8" } }));
        if (p.timer) clearTimeout(p.timer);
        return;
      }
      case "ws-msg": {
        const sub = this.ctx.getWebSockets(`sub:${h.id}`)[0];
        if (!sub) return;
        try {
          sub.send(h.text ? new TextDecoder().decode(frame.payload) : frame.payload.slice());
        } catch {
          // closing
        }
        return;
      }
      case "ws-close": {
        const sub = this.ctx.getWebSockets(`sub:${h.id}`)[0];
        if (sub) safeClose(sub, validCode(h.code), h.reason.slice(0, 100));
        return;
      }
      default:
        // ws-ready needs nothing: the viewer's socket was accepted already
        return;
    }
  }

  private failAll(message: string) {
    for (const [id, p] of this.pending) {
      this.pending.delete(id);
      if (p.writer) void p.writer.abort(message).catch(() => {});
      else {
        if (p.timer) clearTimeout(p.timer);
        p.resolve(new Response(message, { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } }));
      }
    }
  }
}

function colorOf(id: string) {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

/** Close codes a socket may be closed with (1005, 1006 and 1015 are reserved). */
const validCode = (code: number) => (code === 1000 || (code >= 3000 && code <= 4999) ? code : 1000);

function safeClose(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(validCode(code), reason);
  } catch {
    // already closed
  }
}
