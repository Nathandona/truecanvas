import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { captureHeight, normalizeShot, shotLayout, Shots } from "../dist/core/index.js";

test("a shot is completed and made safe from any input", () => {
  const s = normalizeShot({ frame: "Home", format: "nope", backdrop: { colors: ["red", "#123456", "url(x)"], grain: 9 }, framing: { tilt: 90, chrome: "tv" } });
  assert.equal(s.format, "4:5");
  // only real colors are kept, and too few fall back to the defaults
  assert.equal(s.backdrop.colors.includes("url(x)"), false);
  assert.equal(s.backdrop.grain, 1);
  assert.equal(s.framing.tilt, 20);
  assert.equal(s.framing.chrome, "none");
  assert.match(s.id, /^[a-z0-9]+$/);
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
