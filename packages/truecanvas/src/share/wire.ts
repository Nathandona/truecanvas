/*
 * Live sessions: the frames the review site's room and Truecanvas (the
 * session's host) exchange over one WebSocket. Shared by both sides, so it
 * only uses what Workers and Node both have.
 *
 * Text messages carry presence and events (JSON). A binary message is one
 * tunnel frame:
 *   [4 bytes: header length, big endian][header: JSON, UTF-8][payload bytes]
 * Viewers' requests for the app travel host-ward as req (+ req-body chunks,
 * req-end); the host answers with res, res-body chunks and res-end.
 * WebSockets (the dev server's HMR) are sub-streams: ws-open, ws-msg, ws-close.
 */

export type Pairs = [string, string][];

export type TunnelHeader =
  | { t: "req"; id: string; method: string; path: string; headers: Pairs; body: boolean }
  | { t: "req-body"; id: string }
  | { t: "req-end"; id: string }
  | { t: "req-abort"; id: string }
  | { t: "res"; id: string; status: number; headers: Pairs }
  | { t: "res-body"; id: string }
  | { t: "res-end"; id: string }
  | { t: "res-error"; id: string; message: string }
  | { t: "ws-open"; id: string; path: string; headers: Pairs; protocols: string[] }
  | { t: "ws-ready"; id: string; protocol: string }
  | { t: "ws-msg"; id: string; text: boolean }
  | { t: "ws-close"; id: string; code: number; reason: string };

/** Body chunks: well under the 1 MiB WebSocket message limit of Workers. */
export const CHUNK = 256 * 1024;

const enc = new TextEncoder();
const dec = new TextDecoder();

export function encodeFrame(header: TunnelHeader, payload?: Uint8Array): Uint8Array<ArrayBuffer> {
  const head = enc.encode(JSON.stringify(header));
  const out = new Uint8Array(4 + head.length + (payload?.length ?? 0));
  new DataView(out.buffer).setUint32(0, head.length);
  out.set(head, 4);
  if (payload) out.set(payload, 4 + head.length);
  return out;
}

export function decodeFrame(data: ArrayBuffer | Uint8Array): { header: TunnelHeader; payload: Uint8Array } {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes.length < 4) throw new Error("Short tunnel frame");
  const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0);
  if (size > bytes.length - 4) throw new Error("Bad tunnel frame");
  const header = JSON.parse(dec.decode(bytes.subarray(4, 4 + size))) as TunnelHeader;
  if (!header || typeof header.t !== "string" || typeof header.id !== "string") throw new Error("Bad tunnel frame");
  return { header, payload: bytes.subarray(4 + size) };
}

/**
 * A path the tunnel may ask the app for: absolute-path only ("/x?y"), never a
 * full URL, a protocol-relative "//host", a backslash or control characters,
 * so a request can't be pointed at another host or port. Null when refused.
 */
export function safePath(path: string): string | null {
  if (typeof path !== "string" || path.length > 8192) return null;
  if (!path.startsWith("/") || path.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(path)) return null;
  // percent-encoded slashes or backslashes at the start would decode into "//host"
  if (/^\/(%2f|%5c)/i.test(path)) return null;
  return path;
}

/** Request headers dropped on the way to the app: hop-by-hop, the browser's own, and the review site's. */
const DROP_REQUEST = new Set([
  "host",
  "connection",
  "keep-alive",
  "upgrade",
  "transfer-encoding",
  "te",
  "trailer",
  "proxy-authorization",
  "proxy-connection",
  "content-length",
  "accept-encoding",
  "origin",
  "referer",
  "authorization",
  "cdn-loop",
  "x-real-ip",
  "true-client-ip",
  "sec-websocket-key",
  "sec-websocket-version",
  "sec-websocket-extensions",
  "sec-websocket-protocol",
]);

/**
 * What a viewer's request carries to the app. The review site's cookies
 * (tc_*) and its proxy headers stay behind; the app's own cookies go along.
 */
export function requestHeaders(headers: Iterable<[string, string]>): Pairs {
  const out: Pairs = [];
  for (const [k, v] of headers) {
    const key = k.toLowerCase();
    if (DROP_REQUEST.has(key) || key.startsWith("cf-") || key.startsWith("x-forwarded-") || key.startsWith("sec-fetch-") || key.startsWith("x-tc-")) continue;
    if (key === "cookie") {
      const kept = v
        .split(";")
        .map((c) => c.trim())
        .filter((c) => c && !c.startsWith("tc_"));
      if (kept.length) out.push(["cookie", kept.join("; ")]);
      continue;
    }
    out.push([key, v]);
  }
  return out;
}

/** Response headers dropped on the way back: hop-by-hop, and lengths the tunnel re-frames. */
const DROP_RESPONSE = new Set(["connection", "keep-alive", "transfer-encoding", "content-encoding", "content-length", "upgrade", "trailer", "alt-svc"]);

export function responseHeaders(headers: Iterable<[string, string]>): Pairs {
  const out: Pairs = [];
  for (const [k, v] of headers) {
    const key = k.toLowerCase();
    if (!DROP_RESPONSE.has(key)) out.push([key, v]);
  }
  return out;
}
