import { test } from "node:test";
import assert from "node:assert/strict";
import { viewerHtml } from "../dist/share/index.js";

test("the review page's script parses", () => {
  const html = viewerHtml();
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.ok(scripts.length > 0);
  // a syntax error here breaks every share link: compile without running
  for (const js of scripts) assert.doesNotThrow(() => new Function(js));
});
