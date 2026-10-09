import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureHeight, linkScroll, normalizeShot, scrollProgress, shotLayout, shotPoseAt, Shots } from "../dist/core/index.js";

test("a shot is completed and made safe from any input", () => {
  const s = normalizeShot({ frame: "Home", format: "nope", backdrop: { colors: ["red", "#123456", "url(x)"], grain: 9 }, framing: { tilt: 90, chrome: "tv" } });
  assert.equal(s.format, "4:5");
  // only real colors are kept, and too few fall back to the defaults
  assert.equal(s.backdrop.colors.includes("url(x)"), false);
  assert.equal(s.backdrop.grain, 1);
  assert.equal(s.framing.tilt, 20);
  assert.equal(s.framing.chrome, "none");
  assert.match(s.id, /^[a-z0-9]+$/);
  // videos: 60 fps unless 30 is asked for
  assert.equal(s.motion.fps, 60);
  assert.equal(normalizeShot({ motion: { fps: 30 } }).motion.fps, 30);
  assert.equal(normalizeShot({ motion: { fps: 120 } }).motion.fps, 60);
});

test("the frame fits the format, centered or off the edge", () => {
  const centered = shotLayout(normalizeShot({ frame: "Home", format: "4:5" }), { width: 1440, height: 1100 });
  assert.ok(centered.left >= 0 && centered.left + centered.boxW <= centered.W);
  assert.ok(centered.top >= 0 && centered.top + centered.boxH <= centered.H);
  const bleed = normalizeShot({ frame: "Home", format: "4:5", framing: { position: "bleed" } });
  const tall = shotLayout(bleed, { width: 1440, height: captureHeight(bleed, 1440) });
  // off the edge: the frame runs past the bottom of the format
  assert.ok(tall.top + tall.boxH > tall.H);
});

test("shots are saved next to the canvas, newest first", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tc-shots-"));
  fs.mkdirSync(path.join(root, "canvas"));
  const shots = new Shots({ root, canvasDir: "canvas" });
  const a = shots.save("home", { frame: "Home" });
  const b = shots.save("home", { frame: "Pricing", format: "1:1" });
  assert.deepEqual(shots.list("home").map((s) => s.id), [b.id, a.id]);
  shots.save("home", { ...a, format: "16:9" });
  assert.equal(shots.get("home", a.id).format, "16:9");
  assert.equal(shots.list("home")[0].id, a.id);
  assert.ok(shots.remove("home", a.id) && shots.remove("home", b.id));
  assert.equal(fs.existsSync(path.join(root, "canvas", "home.shots.json")), false);
  fs.rmSync(root, { recursive: true, force: true });
});

test("a video's motion starts hidden or low, and settles in place", () => {
  const reveal = normalizeShot({ frame: "Home", kind: "video", motion: { template: "reveal", duration: 6 } });
  const start = shotPoseAt(reveal, 0);
  const end = shotPoseAt(reveal, 6);
  assert.ok(start.opacity < 0.1 && start.y > 100);
  assert.equal(end.opacity, 1);
  assert.ok(Math.abs(end.y) < 0.5);
  // scroll: a beat at the top, the whole distance by the end
  const scroll = normalizeShot({ frame: "Home", kind: "video", motion: { template: "scroll", duration: 8, scrollDistance: 2000 } });
  assert.equal(shotPoseAt(scroll, 0.5).scroll, 0);
  assert.equal(Math.round(shotPoseAt(scroll, 8).scroll), 2000);
  // an image never moves
  assert.deepEqual(shotPoseAt(normalizeShot({ frame: "Home" }), 3), { opacity: 1, y: 0, scale: 1, lift: 0, scroll: 0, shaderTime: 0 });
});

test("a scroll eases in, cruises and eases out, without a jolt", () => {
  const T = 6;
  let prev = 0;
  let peak = 0;
  let prevSpeed = 0;
  let jump = 0;
  for (let i = 1; i <= 600; i++) {
    const p = scrollProgress(i / 100, T);
    const speed = (p - prev) * 100;
    peak = Math.max(peak, speed);
    if (i > 1) jump = Math.max(jump, Math.abs(speed - prevSpeed));
    prev = p;
    prevSpeed = speed;
  }
  assert.equal(scrollProgress(T, T), 1);
  // the top speed stays close to the average: no rush mid-way
  assert.ok(peak * T < 1.25, `peak ${peak * T}`);
  // speed changes smoothly from one hundredth of a second to the next
  assert.ok(jump < 0.01, `jump ${jump}`);
});

test("a scroll's distance, speed and length stay linked", () => {
  const m = normalizeShot({ frame: "Home", kind: "video", motion: { template: "scroll", scrollDistance: 2600, scrollSpeed: 520 } }).motion;
  const byDistance = linkScroll(m, "distance");
  // 2600 px at 520 px/s: 5 s of cruise, ramps and beats around it
  assert.ok(byDistance.duration > 7 && byDistance.duration < 8.5, String(byDistance.duration));
  const back = linkScroll(byDistance, "duration");
  assert.ok(Math.abs(back.scrollDistance - 2600) < 80, String(back.scrollDistance));
  const faster = linkScroll({ ...byDistance, scrollSpeed: 800 }, "speed");
  assert.ok(faster.duration < byDistance.duration);
  assert.equal(faster.scrollDistance, 2600);
});
