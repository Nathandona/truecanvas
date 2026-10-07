import { test } from "node:test";
import assert from "node:assert/strict";
import { CHUNK, decodeFrame, encodeFrame, requestHeaders, responseHeaders, safePath } from "../dist/share/index.js";

test("tunnel frames round-trip a header and a payload", () => {
  const payload = new Uint8Array([0, 1, 2, 250, 255]);
  const frame = encodeFrame({ t: "res-body", id: "r1-abc" }, payload);
  const { header, payload: back } = decodeFrame(frame.buffer);
  assert.deepEqual(header, { t: "res-body", id: "r1-abc" });
  assert.deepEqual([...back], [...payload]);
  // no payload, and a frame read from a view into a bigger buffer
  const empty = encodeFrame({ t: "req", id: "r2", method: "GET", path: "/a?b=1", headers: [["accept", "text/html"]], body: false });
  const big = new Uint8Array(empty.length + 20);
  big.set(empty, 10);
  const read = decodeFrame(big.subarray(10, 10 + empty.length));
  assert.equal(read.header.t, "req");
  assert.equal(read.header.path, "/a?b=1");
  assert.equal(read.payload.length, 0);
});

test("tunnel frames reject garbage", () => {
  assert.throws(() => decodeFrame(new Uint8Array([0, 0])));
  assert.throws(() => decodeFrame(new Uint8Array([0, 0, 0, 99, 1, 2])));
  const noId = new TextEncoder().encode(JSON.stringify({ t: "res" }));
  const bad = new Uint8Array(4 + noId.length);
  new DataView(bad.buffer).setUint32(0, noId.length);
  bad.set(noId, 4);
  assert.throws(() => decodeFrame(bad));
});

test("chunks stay well under the 1 MiB WebSocket message limit", () => {
  const frame = encodeFrame({ t: "res-body", id: "r".repeat(40) }, new Uint8Array(CHUNK));
  assert.ok(frame.length < 1024 * 1024 / 2);
});

test("the tunnel only asks the app for paths, never other hosts", () => {
  for (const ok of ["/", "/truecanvas/home?frame=Home", "/_next/static/chunks/a.js", "/a%20b"]) assert.equal(safePath(ok), ok);
  for (const bad of ["http://evil.com/", "//evil.com/x", "/\\evil.com", "\\\\evil", "evil.com", "/%2fevil.com", "/%5Cevil", "/a\nb", "", "x".repeat(9000)]) assert.equal(safePath(bad), null, bad);
  // resolved against the app's origin, a safe path stays on it
  const app = new URL("http://localhost:3000");
  for (const p of ["/x", "/..//evil.com", "/.%2e/x"]) {
    const s = safePath(p);
    if (s) assert.equal(new URL(s, app).origin, app.origin, p);
  }
});

test("the app never sees the review site's cookies or proxy headers", () => {
  const out = Object.fromEntries(
    requestHeaders([
      ["Cookie", "tc_live=secret; app_session=1; tc_abcdef=x"],
      ["Authorization", "Bearer x"],
      ["Origin", "https://k-session-live.example.com"],
      ["CF-Connecting-IP", "1.2.3.4"],
      ["X-Forwarded-For", "1.2.3.4"],
      ["Sec-Fetch-Site", "cross-site"],
      ["X-TC-Who", "{}"],
      ["Accept", "text/html"],
      ["Host", "k-session-live.example.com"],
    ]),
  );
  assert.deepEqual(out, { cookie: "app_session=1", accept: "text/html" });
  const res = Object.fromEntries(responseHeaders([["Content-Encoding", "gzip"], ["Content-Length", "10"], ["Set-Cookie", "a=1"], ["Content-Type", "text/html"]]));
  assert.deepEqual(res, { "set-cookie": "a=1", "content-type": "text/html" });
});
