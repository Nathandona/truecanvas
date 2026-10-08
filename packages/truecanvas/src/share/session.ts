import { reviewSite, siteFeatures, type ReviewSite } from "./publish.js";
import { CHUNK, decodeFrame, encodeFrame, responseHeaders, safePath, type Pairs, type TunnelHeader } from "./wire.js";

/*
 * Live sessions, the studio's side: Truecanvas joins the link's room on the
 * review site as its host. Viewers' requests for the app arrive through that
 * WebSocket (frames in wire.ts) and are answered from the project's dev
 * server, never anything else: only paths, only the app's own origin. HMR
 * sockets are relayed too, so viewers' frames follow the studio's edits.
 * The same socket carries presence (cursors, who's here) and comment events.
 */

export type RoomEvent =
  | { t: "hello"; you: RoomPerson; live: boolean; route: string | null; people: RoomPerson[] }
  | { t: "join"; person: RoomPerson }
  | { t: "leave"; id: string }
  | { t: "cursor"; id: string; x: number | null; y: number | null }
  | { t: "state"; live: boolean; route: string | null }
  | { t: "comments"; updated: number };

export interface RoomPerson {
  id: string;
  name: string;
  kind: "client" | "studio";
  color: string;
}

export interface SessionState {
  canvas: string;
  status: "connecting" | "live" | "reconnecting" | "stopped";
  /** the link clients open */
  url: string;
  error: string | null;
  people: RoomPerson[];
  you: string | null;
}

/** The host keeps at most this much unsent on the room's socket before waiting. */
const BUFFER_LIMIT = 4 * 1024 * 1024;
const MAX_REQUEST_BODY = 10 * 1024 * 1024;

interface Inflight {
  controller: AbortController;
  body: ReadableStreamDefaultController<Uint8Array> | null;
  size: number;
}

interface Relay {
  socket: WebSocket | null;
  queue: { data: string | Uint8Array<ArrayBuffer> }[];
}

export class LiveSession {
  private socket: WebSocket | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  private inflight = new Map<string, Inflight>();
  private relays = new Map<string, Relay>();
  private cursorTimer: ReturnType<typeof setTimeout> | null = null;
  private cursorLast = 0;
  private cursorNext: { x: number | null; y: number | null } | null = null;
  private readonly app: URL;
  state: SessionState;

  constructor(
    private site: ReviewSite,
    private slug: string,
    canvas: string,
    appUrl: string,
    private opts: { name: string; route: string; onEvent?: (e: RoomEvent) => void; onState?: (s: SessionState) => void },
  ) {
    this.app = new URL(appUrl);
    this.state = { canvas, status: "connecting", url: `${site.url}/s/${slug}`, error: null, people: [], you: null };
  }

  start() {
    this.stopped = false;
    this.connect();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.socket?.close(1000, "The studio ended the session");
    this.socket = null;
    this.cleanup();
    this.setState({ status: "stopped", people: [] });
  }

  /** The studio's cursor on the canvas (canvas coordinates), or null when it left. Throttled. */
  cursor(x: number | null, y: number | null) {
    this.cursorNext = { x, y };
    const wait = 50 - (Date.now() - this.cursorLast);
    if (this.cursorTimer) return;
    const send = () => {
      this.cursorTimer = null;
      if (!this.cursorNext) return;
      this.cursorLast = Date.now();
      this.sendText({ t: "cursor", ...this.cursorNext });
      this.cursorNext = null;
    };
    if (wait <= 0) send();
    else this.cursorTimer = setTimeout(send, wait);
  }

  private setState(change: Partial<SessionState>) {
    this.state = { ...this.state, ...change };
    this.opts.onState?.(this.state);
  }

  private connect() {
    if (this.stopped) return;
    const url = new URL(`${this.site.url}/api/shares/${encodeURIComponent(this.slug)}/room`);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("host", "1");
    url.searchParams.set("name", this.opts.name);
    url.searchParams.set("route", this.opts.route);
    // Node's WebSocket takes headers: the token never goes in the URL
    const socket = new WebSocket(url, { headers: { authorization: `Bearer ${this.site.token}` } } as unknown as string[]);
    socket.binaryType = "arraybuffer";
    this.socket = socket;
    let opened = false;
    // idle sockets are dropped after about 100 s: the room answers "ping" without waking up
    const keepAlive = setInterval(() => socket.readyState === WebSocket.OPEN && socket.send("ping"), 30_000);
    keepAlive.unref?.();
    socket.onopen = () => {
      opened = true;
      this.backoff = 1000;
      this.setState({ status: "live", error: null });
    };
    socket.onmessage = (m) => {
      if (typeof m.data === "string") this.onText(m.data);
      else void this.onFrame(m.data as ArrayBuffer);
    };
    socket.onclose = (e) => {
      clearInterval(keepAlive);
      if (this.socket !== socket) return;
      this.socket = null;
      this.cleanup();
      if (this.stopped) return;
      if (e.code === 4000) {
        // another Truecanvas took the session over: don't fight it
        this.stopped = true;
        this.setState({ status: "stopped", error: "Another Truecanvas started a session on this link.", people: [] });
        return;
      }
      this.setState({ status: "reconnecting", error: opened ? null : "Couldn't reach the review site.", people: [] });
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 15_000);
    };
    socket.onerror = () => {
      // onclose follows
    };
  }

  private cleanup() {
    for (const f of this.inflight.values()) f.controller.abort();
    this.inflight.clear();
    for (const r of this.relays.values()) r.socket?.close();
    this.relays.clear();
  }

  private sendText(msg: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(msg));
  }

  private send(header: TunnelHeader, payload?: Uint8Array) {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(encodeFrame(header, payload));
  }

  /** Don't pile megabytes on a slow link: wait until the socket drains. */
  private async drained() {
    while (this.socket && this.socket.readyState === WebSocket.OPEN && this.socket.bufferedAmount > BUFFER_LIMIT) await new Promise((r) => setTimeout(r, 15));
  }

  private onText(data: string) {
    if (data === "pong") return;
    let e: RoomEvent;
    try {
      e = JSON.parse(data) as RoomEvent;
    } catch {
      return;
    }
    if (e.t === "hello") this.setState({ people: e.people, you: e.you.id });
    else if (e.t === "join") this.setState({ people: [...this.state.people.filter((p) => p.id !== e.person.id), e.person] });
    else if (e.t === "leave") this.setState({ people: this.state.people.filter((p) => p.id !== e.id) });
    this.opts.onEvent?.(e);
  }

  // ---------- the tunnel ----------

  /** The app URL for a tunneled path, or null if it would leave the app. */
  private target(path: string, ws = false): URL | null {
    const safe = safePath(path);
    if (!safe) return null;
    const url = new URL(safe, this.app);
    if (url.origin !== this.app.origin) return null;
    if (ws) url.protocol = this.app.protocol === "https:" ? "wss:" : "ws:";
    return url;
  }

  private async onFrame(data: ArrayBuffer) {
    let frame: { header: TunnelHeader; payload: Uint8Array };
    try {
      frame = decodeFrame(data);
    } catch {
      return;
    }
    const h = frame.header;
    switch (h.t) {
      case "req":
        return this.request(h);
      case "req-body": {
        const f = this.inflight.get(h.id);
        if (!f?.body) return;
        f.size += frame.payload.length;
        if (f.size > MAX_REQUEST_BODY) {
          f.controller.abort();
          return;
        }
        f.body.enqueue(frame.payload.slice());
        return;
      }
      case "req-end": {
        const f = this.inflight.get(h.id);
        try {
          f?.body?.close();
        } catch {
          // already closed
        }
        return;
      }
      case "req-abort":
        this.inflight.get(h.id)?.controller.abort();
        this.inflight.delete(h.id);
        return;
      case "ws-open":
        return this.openRelay(h.id, h.path, h.protocols);
      case "ws-msg": {
        const r = this.relays.get(h.id);
        if (!r) return;
        const data = h.text ? new TextDecoder().decode(frame.payload) : frame.payload.slice();
        if (r.socket?.readyState === WebSocket.OPEN) r.socket.send(data);
        else r.queue.push({ data });
        return;
      }
      case "ws-close": {
        const r = this.relays.get(h.id);
        this.relays.delete(h.id);
        r?.socket?.close();
        return;
      }
    }
  }

  private async request(h: Extract<TunnelHeader, { t: "req" }>) {
    const target = this.target(h.path);
    if (!target || !["GET", "HEAD", "POST"].includes(h.method)) {
      this.send({ t: "res", id: h.id, status: 403, headers: [["content-type", "text/plain; charset=utf-8"]] });
      this.send({ t: "res-body", id: h.id }, new TextEncoder().encode("Not part of the app."));
      this.send({ t: "res-end", id: h.id });
      return;
    }
    const controller = new AbortController();
    const entry: Inflight = { controller, body: null, size: 0 };
    let body: ReadableStream<Uint8Array> | undefined;
    if (h.body) body = new ReadableStream<Uint8Array>({ start: (c) => void (entry.body = c) });
    this.inflight.set(h.id, entry);
    try {
      const headers = new Headers();
      for (const [k, v] of h.headers) {
        try {
          headers.append(k, v);
        } catch {
          // a header fetch won't send
        }
      }
      const res = await fetch(target, {
        method: h.method,
        headers,
        body,
        redirect: "manual",
        signal: controller.signal,
        ...(body ? { duplex: "half" } : {}),
      } as RequestInit);
      this.send({ t: "res", id: h.id, status: res.status, headers: this.answerHeaders(res.headers) });
      if (res.body && h.method !== "HEAD") {
        const reader = res.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (let i = 0; i < value.length; i += CHUNK) {
            await this.drained();
            if (!this.inflight.has(h.id)) {
              await reader.cancel().catch(() => {});
              return;
            }
            this.send({ t: "res-body", id: h.id }, value.subarray(i, i + CHUNK));
          }
        }
      }
      this.send({ t: "res-end", id: h.id });
    } catch (err) {
      if (!controller.signal.aborted) this.send({ t: "res-error", id: h.id, message: (err as Error).message || "request failed" });
    } finally {
      this.inflight.delete(h.id);
    }
  }

  /** The app's answer headers, with redirects to itself made relative (they'd point at localhost otherwise). */
  private answerHeaders(headers: Headers): Pairs {
    const out = responseHeaders(headers);
    return out.map(([k, v]) => {
      if (k !== "location") return [k, v];
      try {
        const to = new URL(v, this.app);
        return [k, to.origin === this.app.origin ? to.pathname + to.search + to.hash : v];
      } catch {
        return [k, v];
      }
    });
  }

  private openRelay(id: string, path: string, protocols: string[]) {
    const target = this.target(path, true);
    if (!target) {
      this.send({ t: "ws-close", id, code: 1008, reason: "Not part of the app" });
      return;
    }
    const relay: Relay = { socket: null, queue: [] };
    this.relays.set(id, relay);
    let socket: WebSocket;
    try {
      socket = new WebSocket(target, protocols);
    } catch (err) {
      this.relays.delete(id);
      this.send({ t: "ws-close", id, code: 1011, reason: (err as Error).message.slice(0, 100) });
      return;
    }
    socket.binaryType = "arraybuffer";
    relay.socket = socket;
    socket.onopen = () => {
      this.send({ t: "ws-ready", id, protocol: socket.protocol });
      for (const m of relay.queue) socket.send(m.data);
      relay.queue = [];
    };
    socket.onmessage = (m) => {
      const text = typeof m.data === "string";
      this.send({ t: "ws-msg", id, text }, text ? new TextEncoder().encode(m.data as string) : new Uint8Array(m.data as ArrayBuffer));
    };
    socket.onclose = (e) => {
      if (!this.relays.has(id)) return;
      this.relays.delete(id);
      this.send({ t: "ws-close", id, code: e.code, reason: e.reason });
    };
    socket.onerror = () => {
      // onclose follows
    };
  }
}

/**
 * The project's live sessions, one per canvas: what the editor's Start
 * session button, the CLI, the MCP tools and (later) the desktop tray use.
 */
export class Sessions {
  private sessions = new Map<string, LiveSession>();

  constructor(
    private project: string,
    private appUrl: string,
    private events: { onEvent?: (canvas: string, e: RoomEvent) => void; onState?: (s: SessionState) => void } = {},
  ) {}

  list(): SessionState[] {
    return [...this.sessions.values()].map((s) => s.state);
  }

  get(canvas: string): LiveSession | null {
    return this.sessions.get(canvas) ?? null;
  }

  /**
   * Starts (or returns) the canvas's session. A canvas that has no link yet is
   * shared first through `opts.share` (invited-only on sites with sign-in), so
   * going live is one click.
   */
  async start(canvas: string, opts: { name?: string; share?: () => Promise<unknown> } = {}): Promise<SessionState> {
    const running = this.sessions.get(canvas);
    if (running && running.state.status !== "stopped") return running.state;
    const site = reviewSite();
    if (!site) throw new Error("No review site yet: connect one with `npx truecanvas share setup`, share the canvas, then start a session.");
    const features = await siteFeatures(site);
    if (!features.includes("session")) throw new Error("This review site doesn't support live sessions yet: deploy the latest review site (packages/review-worker) with LIVE_HOST_SUFFIX set.");
    const lookup = async () => {
      const res = await fetch(`${site.url}/api/shares?project=${encodeURIComponent(this.project)}&canvas=${encodeURIComponent(canvas)}`, {
        headers: { authorization: `Bearer ${site.token}` },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Review site: ${res.status} ${res.statusText}`);
      return ((await res.json()) as { slug: string | null }).slug;
    };
    let slug = await lookup();
    if (!slug && opts.share) {
      await opts.share();
      slug = await lookup();
    }
    if (!slug) throw new Error(`${canvas} has no link yet. Share it once (Share, or \`npx truecanvas share ${canvas}\`), then start a session.`);
    const session = new LiveSession(site, slug, canvas, this.appUrl, {
      name: opts.name ?? "Studio",
      route: "/truecanvas/",
      onEvent: (e) => this.events.onEvent?.(canvas, e),
      onState: (s) => this.events.onState?.(s),
    });
    this.sessions.set(canvas, session);
    session.start();
    return session.state;
  }

  stop(canvas: string): boolean {
    const s = this.sessions.get(canvas);
    if (!s) return false;
    s.stop();
    this.sessions.delete(canvas);
    return true;
  }

  stopAll() {
    for (const canvas of [...this.sessions.keys()]) this.stop(canvas);
  }
}
