import { test, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { injectIds, parseCanvas, Workspace, loadConfig, outlineDoc, iconLibraries, loadIcons, searchIcons, shadcnStatus, Git, wrapConfigExport, addVitePlugin, configStatus, initProject, syncRoute, viteStylesheets } from "../dist/core/index.js";
import { truecanvas as vitePlugin } from "../dist/vite/index.js";
import { execFileSync } from "node:child_process";

const CANVAS = `"use client";
import { Canvas, Frame } from "truecanvas";
import { Button } from "@/components/button";

export default function Demo() {
  return (
    <Canvas>
      <Frame name="Main" x={0} y={0} width={800}>
        <div className="flex flex-col gap-2 p-4">
          <Button variant="primary">Save</Button>
          <Button>Cancel</Button>
          <p>Hello {"world"}</p>
        </div>
      </Frame>
      <Frame name="Side" x={900} y={0} width={320} height={400} theme="dark">
        <Button size="sm" disabled className="this-line-is-deliberately-long-so-prettier-would-reflow-it-and-the-file-is-not-prettier-clean" />
      </Frame>
    </Canvas>
  );
}
`;

const BUTTON = `export type ButtonProps = {
  /** Visual style */
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  disabled?: boolean;
  children?: React.ReactNode;
  className?: string;
  onClick?: () => void;
};

/** A button. */
export function Button({ variant = "secondary", size = "md", disabled = false, children = "Button", className }: ButtonProps) {
  return <button className={className} data-variant={variant} data-size={size} disabled={disabled}>{children}</button>;
}

export async function ServerOnly() {
  return <div />;
}
`;

let root;
let ws;
const file = () => path.join(root, "canvas/demo.canvas.tsx");
const read = () => fs.readFileSync(file(), "utf8");
const user = { kind: "user" };
const idOf = (pred) => {
  const doc = ws.doc("demo");
  const stack = [...doc.frames];
  while (stack.length) {
    const n = stack.shift();
    if (pred(n)) return n.id;
    stack.push(...n.children);
  }
  throw new Error("node not found");
};

function reset() {
  fs.writeFileSync(file(), CANVAS);
  ws = new Workspace(loadConfig(root));
}

before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-test-"));
  fs.mkdirSync(path.join(root, "canvas"));
  fs.mkdirSync(path.join(root, "components"));
  fs.mkdirSync(path.join(root, "app"));
  fs.writeFileSync(path.join(root, "package.json"), "{}");
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true, paths: { "@/*": ["./*"] } } }));
  fs.writeFileSync(path.join(root, "components/button.tsx"), BUTTON);
  // real React types, like a real project
  fs.symlinkSync(path.resolve("../../examples/playground/node_modules"), path.join(root, "node_modules"), "junction");
  reset();
});

test("injectIds stamps every element without moving lines", () => {
  const out = injectIds(CANVAS);
  assert.equal(out.split("\n").length, CANVAS.split("\n").length);
  assert.match(out, /<Button data-tc="10:10" variant="primary">/);
  assert.match(out, /<Frame data-tc="8:6" name="Main"/);
});

test("parseCanvas reads frames, props, text and expressions", () => {
  const doc = parseCanvas("demo", "canvas/demo.canvas.tsx", CANVAS);
  assert.equal(doc.frames.length, 2);
  const [main, side] = doc.frames;
  assert.deepEqual([main.frameName, main.width, main.height, main.theme], ["Main", 800, null, null]);
  assert.deepEqual([side.frameName, side.height, side.theme], ["Side", 400, "dark"]);
  const stack = main.children[0];
  assert.equal(stack.kind, "element");
  assert.deepEqual(stack.props.className, { kind: "string", value: "flex flex-col gap-2 p-4" });
  const p = stack.children[2];
  assert.deepEqual(p.children.map((c) => c.kind), ["text", "text"]);
  assert.deepEqual(side.children[0].props.disabled, { kind: "boolean", value: true });
});

test("outline is compact and carries ids", () => {
  const text = outlineDoc(parseCanvas("demo", "x", CANVAS));
  assert.match(text, /frame "Main" \[8:6\] x=0 y=0 w=800 h=hug theme=inherit/);
  assert.match(text, /<Button variant="primary">Save<\/Button> \[10:10\]/);
});

test("catalog reads prop types, defaults, docs, and skips async components", async () => {
  await ws.catalog.load();
  const button = ws.catalog.get("Button");
  assert.ok(button);
  const variant = button.props.find((p) => p.name === "variant");
  assert.deepEqual(variant.options, ["primary", "secondary", "ghost"]);
  assert.equal(variant.default, "secondary");
  assert.equal(variant.description, "Visual style");
  assert.equal(button.props.find((p) => p.name === "onClick").type, "function");
  assert.equal(button.acceptsChildren, true);
  assert.equal(ws.catalog.get("ServerOnly"), undefined);
});

test("set_props is a one-line diff that keeps the file's formatting", async () => {
  reset();
  const id = idOf((n) => n.name === "Button" && n.children[0]?.text === "Cancel");
  await ws.run({ op: "set_props", canvas: "demo", id, props: { variant: "ghost", disabled: true } }, user);
  const before = CANVAS.split("\n");
  const after = read().split("\n");
  const changed = after.filter((l, i) => l !== before[i]);
  assert.deepEqual(changed, [`          <Button variant="ghost" disabled>Cancel</Button>`]);
  // null removes the prop again
  await ws.run({ op: "set_props", canvas: "demo", id, props: { variant: null, disabled: null } }, user);
  assert.equal(read(), CANVAS);
});

test("insert_component adds an aliased import and indents correctly", async () => {
  reset();
  fs.writeFileSync(file(), CANVAS.replace(`import { Button } from "@/components/button";\n`, ""));
  ws = new Workspace(loadConfig(root));
  const stack = idOf((n) => n.kind === "element" && n.name === "div");
  const res = await ws.run({ op: "insert_component", canvas: "demo", parent: stack, index: 0, component: "Button" }, user);
  const src = read();
  assert.match(src, /import \{ Button \} from "@\/components\/button";/);
  assert.match(src, /\n {10}<Button \/>\n {10}<Button variant="primary">Save<\/Button>/);
  assert.equal(res.ids.length, 1);
});

test("insert_jsx pretty-prints agent snippets and validates JSX", async () => {
  reset();
  const frame = idOf((n) => n.frameName === "Side");
  await ws.run({ op: "insert_jsx", canvas: "demo", parent: frame, jsx: `<div className="flex gap-2"><Button>One</Button><Button>Two</Button></div>` }, user);
  assert.match(read(), /\n {8}<div className="flex gap-2">\n {10}<Button>One<\/Button>\n {10}<Button>Two<\/Button>\n {8}<\/div>/);
  await assert.rejects(ws.run({ op: "insert_jsx", canvas: "demo", parent: frame, jsx: `<div>` }, user), /Invalid JSX/);
  await assert.rejects(ws.run({ op: "insert_jsx", canvas: "demo", parent: frame, jsx: `<Nope />` }, user), /Unknown component <Nope>/);
});

test("move, reorder and wrap keep the selection on the moved node", async () => {
  reset();
  const cancel = idOf((n) => n.children[0]?.text === "Cancel");
  const res = await ws.run({ op: "reorder", canvas: "demo", id: cancel, delta: -1 }, user);
  assert.match(read(), /<Button>Cancel<\/Button>\n {10}<Button variant="primary">Save<\/Button>/);
  assert.doesNotMatch(read(), /__tcsel/);
  const moved = ws.doc("demo");
  assert.equal(parseCanvas("d", "f", read()).frames[0].children[0].children[0].id, res.ids[0]);
  void moved;

  const save = idOf((n) => n.children[0]?.text === "Save");
  const side = idOf((n) => n.frameName === "Side");
  await ws.run({ op: "move", canvas: "demo", id: save, parent: side }, user);
  const doc = ws.doc("demo");
  assert.equal(doc.frames[1].children.length, 2);
  assert.equal(doc.frames[0].children[0].children.length, 2);

  const a = idOf((n) => n.children[0]?.text === "Cancel");
  const p = idOf((n) => n.name === "p");
  await ws.run({ op: "wrap", canvas: "demo", ids: [a, p] }, user);
  assert.match(read(), /<div className="flex flex-col gap-2">\n {12}<Button>Cancel<\/Button>\n {12}<p>/);
});

test("delete removes the whole line, duplicate frame gets a free spot", async () => {
  reset();
  const cancel = idOf((n) => n.children[0]?.text === "Cancel");
  await ws.run({ op: "delete", canvas: "demo", ids: [cancel] }, user);
  assert.equal(read(), CANVAS.replace(`          <Button>Cancel</Button>\n`, ""));
  const main = idOf((n) => n.frameName === "Main");
  await ws.run({ op: "duplicate", canvas: "demo", ids: [main] }, user);
  const doc = ws.doc("demo");
  const copy = doc.frames.find((f) => f.frameName === "Main copy");
  assert.ok(copy);
  assert.equal(copy.x, 1300); // right of "Side", which overlaps vertically
});

test("frames: create, update, hug, theme", async () => {
  reset();
  await ws.run({ op: "create_frame", canvas: "demo", name: "Main", width: 400 }, user);
  let doc = ws.doc("demo");
  assert.equal(doc.frames[2].frameName, "Main 2");
  assert.equal(doc.frames[2].x, 1300);
  await ws.run({ op: "update_frame", canvas: "demo", frame: "Side", height: null, theme: null, width: 360 }, user);
  doc = ws.doc("demo");
  assert.deepEqual([doc.frames[1].height, doc.frames[1].theme, doc.frames[1].width], [null, null, 360]);
});

test("undo/redo restore exact sources and refuse after external edits", async () => {
  reset();
  const id = idOf((n) => n.children[0]?.text === "Save");
  await ws.run({ op: "set_text", canvas: "demo", id, text: "Store {it}" }, user);
  assert.match(read(), /<Button variant="primary">\{"Store \{it\}"\}<\/Button>/);
  await ws.undo("demo", user);
  assert.equal(read(), CANVAS);
  await ws.redo("demo", user);
  assert.match(read(), /Store \{it\}/);
  fs.writeFileSync(file(), read().replace("Cancel", "Dismiss"));
  await assert.rejects(ws.undo("demo", user), /file changed since/);
  ws.externalChange("demo.canvas.tsx");
  await ws.undo("demo", user); // undoes the external edit itself
  assert.match(read(), /Cancel/);
});

test("create_variants renders one instance per union member", async () => {
  reset();
  await ws.run({ op: "create_variants", canvas: "demo", component: "Button", prop: "variant" }, user);
  const src = read();
  assert.match(src, /<Button variant="primary">Primary<\/Button>\n {10}<Button variant="secondary">Secondary<\/Button>\n {10}<Button variant="ghost">Ghost<\/Button>/);
});

test("prettier-formatted files stay prettier-formatted", async () => {
  reset();
  const prettier = await import("prettier");
  const formatted = await prettier.format(CANVAS, { parser: "typescript", printWidth: 100 });
  fs.writeFileSync(file(), formatted);
  ws = new Workspace(loadConfig(root));
  const id = idOf((n) => n.children[0]?.text === "Save");
  await ws.run({ op: "set_props", canvas: "demo", id, props: { size: "sm" } }, user);
  const out = read();
  assert.equal(out, await prettier.format(out, { parser: "typescript", printWidth: 100 }));
});

// ---------- regressions from review ----------

test("set_text on a text node keeps surrounding JSX whitespace", async () => {
  reset();
  const p = idOf((n) => n.name === "p");
  const textId = ws.doc("demo").frames[0].children[0].children[2].children[0].id;
  void p;
  await ws.run({ op: "set_text", canvas: "demo", id: textId, text: "Bye" }, user);
  assert.match(read(), /<p>Bye \{"world"\}<\/p>/);
});

test("wrap rejects frames and non-adjacent siblings", async () => {
  reset();
  const [main, side] = ws.doc("demo").frames.map((f) => f.id);
  await assert.rejects(ws.run({ op: "wrap", canvas: "demo", ids: [main, side] }, user), /Frames can't be wrapped/);
  const save = idOf((n) => n.children[0]?.text === "Save");
  const p = idOf((n) => n.name === "p");
  await assert.rejects(ws.run({ op: "wrap", canvas: "demo", ids: [save, p] }, user), /adjacent/);
});

test("generic components, entities and bad prop names are handled", async () => {
  assert.match(injectIds(`const a = <Select<Opt> value={1} />;`), /<Select<Opt> data-tc="1:10" value=\{1\}/);
  reset();
  const save = idOf((n) => n.children[0]?.text === "Save");
  await ws.run({ op: "set_props", canvas: "demo", id: save, props: { title: "Fish &amp; chips" } }, user);
  assert.match(read(), /title=\{"Fish &amp; chips"\}/);
  await assert.rejects(ws.run({ op: "set_props", canvas: "demo", id: save, props: { "bad name": 1 } }, user), /Invalid prop name/);
  await assert.rejects(ws.run({ op: "set_props", canvas: "demo", id: save, props: { "data-tc": "x" } }, user), /Invalid prop name/);
});

test("imports: type-only imports are not reused, and new imports go after 'use client'", async () => {
  fs.writeFileSync(file(), CANVAS.replace(`import { Button } from "@/components/button";`, `import type { ButtonProps } from "@/components/button";`));
  ws = new Workspace(loadConfig(root));
  const frame = ws.doc("demo").frames[1].id;
  await ws.run({ op: "insert_component", canvas: "demo", parent: frame, component: "Button" }, user);
  assert.match(read(), /import type \{ ButtonProps \} from "@\/components\/button";\nimport \{ Button \} from "@\/components\/button";/);

  fs.writeFileSync(file(), CANVAS.replace(/import .*\n/g, "").replace(`<Button variant="primary">Save</Button>`, "").replace(/<Button[^\n]*\n/g, ""));
  ws = new Workspace(loadConfig(root));
  await ws.run({ op: "insert_component", canvas: "demo", parent: ws.doc("demo").frames[0].id, component: "Button" }, user);
  assert.match(read(), /^"use client";\nimport \{ Button \} from "@\/components\/button";/);
});

test("insert_jsx accepts components declared in the canvas file", async () => {
  fs.writeFileSync(file(), CANVAS + `\nfunction Hero() {\n  return <h1>Hi</h1>;\n}\n`);
  ws = new Workspace(loadConfig(root));
  await ws.run({ op: "insert_jsx", canvas: "demo", parent: "Side", jsx: "<Hero />" }, user);
  assert.match(read(), /<Hero \/>/);
});

test("duplicating two frames gives unique names and positions", async () => {
  reset();
  const [main, side] = ws.doc("demo").frames.map((f) => f.id);
  await ws.run({ op: "duplicate", canvas: "demo", ids: [main, side] }, user);
  const frames = ws.doc("demo").frames;
  const names = frames.map((f) => f.frameName);
  assert.equal(new Set(names).size, names.length);
  const xs = frames.filter((f) => f.frameName.endsWith("copy")).map((f) => f.x);
  assert.equal(new Set(xs).size, 2);
});

// ---------- arrays, presets, backgrounds, devices ----------

test("array props parse and write as literals", async () => {
  reset();
  const save = idOf((n) => n.children[0]?.text === "Save");
  await ws.run({ op: "set_props", canvas: "demo", id: save, props: { colors: ["#fff", "#000"] } }, user);
  assert.match(read(), /colors=\{\["#fff", "#000"\]\}/);
  const node = ws.doc("demo").frames[0].children[0].children[0];
  assert.deepEqual(node.props.colors, { kind: "array", value: ["#fff", "#000"] });
});

test("frames take device presets", async () => {
  reset();
  await ws.run({ op: "create_frame", canvas: "demo", device: "iphone-16" }, user);
  const f = ws.doc("demo").frames.at(-1);
  assert.deepEqual([f.frameName, f.width, f.height, f.device], ["iPhone 16", 393, 852, "iphone-16"]);
  await ws.run({ op: "update_frame", canvas: "demo", frame: f.frameName, device: "pixel-9" }, user);
  const g = ws.doc("demo").frames.at(-1);
  assert.deepEqual([g.width, g.height, g.device], [412, 923, "pixel-9"]);
  await assert.rejects(ws.run({ op: "create_frame", canvas: "demo", device: "nokia-3310" }, user), /Unknown device/);
});

test("library components: catalog, presets, add_background, apply_preset", async () => {
  // a tiny fake shader library, shaped like @paper-design/shaders-react
  const lib = path.join(root, "node_modules-fake/fake-shaders");
  fs.mkdirSync(lib, { recursive: true });
  fs.writeFileSync(path.join(lib, "package.json"), JSON.stringify({ name: "fake-shaders", type: "module", main: "index.js", types: "index.d.ts" }));
  fs.writeFileSync(path.join(lib, "index.d.ts"), `
/** Uniforms:
 * - u_distortion (float): Power of distortion (0 to 1)
 */
export interface GlowProps { className?: string; colors?: string[]; colorBack?: string; distortion?: number; speed?: number; }
export declare const Glow: (props: GlowProps) => JSX.Element;
export declare const glowPresets: { name: string; params: Required<Omit<GlowProps, "className">> }[];
`);
  fs.writeFileSync(path.join(lib, "index.js"), `export const Glow = () => null;
export const glowPresets = [
  { name: "Default", params: { colors: ["#111", "#eee"], colorBack: "#000", distortion: 0.5, speed: 1 } },
  { name: "Sunset", params: { colors: ["#f97316", "#ec4899"], colorBack: "#000", distortion: 0.9, speed: 1 } },
];`);
  // resolvable as "fake-shaders" from the project
  const nm = fs.realpathSync(path.join(root, "node_modules"));
  void nm;
  const local = path.join(root, "node_modules-fake");
  fs.writeFileSync(path.join(root, "truecanvas.config.json"), JSON.stringify({ libraries: ["fake-shaders"] }));
  fs.writeFileSync(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true, paths: { "@/*": ["./*"], "fake-shaders": ["./node_modules-fake/fake-shaders/index.d.ts"] } } }));
  // runtime resolution for presets: link into a real node_modules folder
  const realNm = path.join(root, "nm-real");
  fs.mkdirSync(realNm, { recursive: true });
  try {
    fs.unlinkSync(path.join(root, "node_modules"));
  } catch {}
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  fs.symlinkSync(path.resolve("../../examples/playground/node_modules/react"), path.join(root, "node_modules/react"), "junction");
  fs.symlinkSync(path.resolve("../../examples/playground/node_modules/@types"), path.join(root, "node_modules/@types"), "junction");
  fs.symlinkSync(path.join(local, "fake-shaders"), path.join(root, "node_modules/fake-shaders"), "junction");
  reset();
  await ws.catalog.load();
  const glow = ws.catalog.get("Glow");
  assert.ok(glow, "library component in catalog");
  assert.equal(glow.library, "fake-shaders");
  const prop = (n) => glow.props.find((p) => p.name === n);
  assert.equal(prop("colors").type, "colors");
  assert.equal(prop("colorBack").type, "color");
  assert.deepEqual([prop("distortion").min, prop("distortion").max], [0, 1]);
  assert.deepEqual(prop("colors").default, ["#111", "#eee"]);
  assert.deepEqual(glow.presets.map((p) => p.name), ["Default", "Sunset"]);

  await ws.run({ op: "add_background", canvas: "demo", parent: "Main", component: "Glow", preset: "Sunset" }, user);
  let src = read();
  assert.match(src, /import \{ Glow \} from "fake-shaders";/);
  assert.match(src, /<div className="relative isolate flex flex-col gap-2 p-4">\n {10}<Glow className="pointer-events-none absolute inset-0 -z-10 h-full w-full" colors=\{\["#f97316", "#ec4899"\]\} distortion=\{0.9\} \/>/);

  const glowId = idOf((n) => n.name === "Glow");
  await ws.run({ op: "apply_preset", canvas: "demo", id: glowId, preset: "Default" }, user);
  src = read();
  assert.match(src, /<Glow className="pointer-events-none absolute inset-0 -z-10 h-full w-full" \/>/);
  fs.unlinkSync(path.join(root, "truecanvas.config.json"));
});

test("pages: rename, duplicate, delete and restore canvas files", async () => {
  reset();
  ws.renameCanvas("demo", "home");
  assert.ok(fs.existsSync(path.join(root, "canvas/home.canvas.tsx")));
  assert.ok(!fs.existsSync(file()));
  const copy = ws.duplicateCanvas("home");
  assert.equal(copy, "home-copy");
  assert.deepEqual(ws.canvasInfos().map((c) => [c.name, c.frames]), [["home", 2], ["home-copy", 2]]);
  ws.deleteCanvas("home-copy");
  assert.deepEqual(ws.canvases(), ["home"]);
  assert.equal(ws.restoreCanvas("home-copy"), "home-copy");
  assert.throws(() => ws.renameCanvas("home", "home-copy"), /already exists/);
  assert.throws(() => ws.renameCanvas("home", "../evil"), /Invalid canvas name/);
  // the generated route registry follows
  const registry = fs.readFileSync(path.join(root, "app/truecanvas/canvases.tsx"), "utf8");
  assert.match(registry, /"home": lazy/);
  ws.deleteCanvas("home-copy");
  ws.renameCanvas("home", "demo");
});

test("comments: stored next to the page, follow frame renames", async () => {
  reset();
  const author = { name: "Ada", kind: "user" };
  const t = ws.comments.add("demo", { frame: "Main", x: 10, y: 20, node: { path: "0.0", name: "div" }, text: "Tighter please", author });
  assert.ok(fs.existsSync(path.join(root, "canvas/demo.comments.json")));
  ws.comments.reply("demo", t.id, "On it", { name: "claude-code", kind: "agent" });
  ws.comments.resolve("demo", t.id, true, { name: "claude-code", kind: "agent" });
  let [saved] = ws.comments.list("demo");
  assert.equal(saved.messages.length, 2);
  assert.equal(saved.resolved, true);
  await ws.run({ op: "update_frame", canvas: "demo", frame: "Main", name: "Home" }, user);
  [saved] = ws.comments.list("demo");
  assert.equal(saved.frame, "Home");
  ws.comments.remove("demo", t.id);
  assert.ok(!fs.existsSync(path.join(root, "canvas/demo.comments.json")), "empty comment files are removed");
});

test("compare: per-frame changes and relative imports rewritten for the snapshot", async () => {
  const { frameChanges, writeCompare } = await import("../dist/core/index.js");
  const after = CANVAS.replace(">Save<", ">Store<").replace(`<Frame name="Side"`, `<Frame name="New" x={0} y={900} width={100}>\n        <p>new</p>\n      </Frame>\n      <Frame name="Side"`);
  assert.deepEqual(frameChanges(CANVAS, after), { Main: "changed", New: "added", Side: "same" });
  const moved = CANVAS.replace(`x={900}`, `x={1200}`);
  assert.equal(frameChanges(CANVAS, moved).Side, "same", "moving a frame isn't a design change");
  const name = writeCompare(loadConfig(root), "demo", CANVAS.replace(`from "@/components/button"`, `from "../components/button"`));
  assert.equal(name, "__compare__demo");
  const snap = fs.readFileSync(path.join(root, "app/truecanvas/compare/demo.canvas.tsx"), "utf8");
  assert.match(snap, /from "\.\.\/\.\.\/\.\.\/components\/button"/);
  assert.match(fs.readFileSync(path.join(root, "app/truecanvas/canvases.tsx"), "utf8"), /"__compare__demo": lazy/);
});

test("import_route copy: a page and its layouts become layers", async () => {
  reset();
  fs.mkdirSync(path.join(root, "app/(site)"), { recursive: true });
  fs.writeFileSync(path.join(root, "app/(site)/layout.tsx"), `import { Button } from "@/components/button";\nexport default function L({ children }: { children: React.ReactNode }) {\n  return (\n    <>\n      <Button>Nav</Button>\n      <main className="mx-auto">{children}</main>\n    </>\n  );\n}\n`);
  fs.writeFileSync(path.join(root, "app/(site)/page.tsx"), `import { Button } from "@/components/button";\nconst Page = () => (\n  <>\n    <Button variant="primary">Hero</Button>\n    <Button>CTA</Button>\n  </>\n);\nexport default Page;\n`);
  fs.mkdirSync(path.join(root, "app/(site)/blog/[slug]"), { recursive: true });
  fs.writeFileSync(path.join(root, "app/(site)/blog/[slug]/page.tsx"), `export default async function P({ params }) { const { slug } = await params; return <h1>{slug}</h1>; }\n`);
  const { listRoutes } = await import("../dist/core/index.js").then((m) => m).catch(() => ({}));
  void listRoutes;
  await ws.run({ op: "import_route", canvas: "demo", route: "/", copy: true }, user);
  const src = read();
  assert.match(src, /<Frame name="Home" x=\{1300\} y=\{0\} width=\{1440\}>/);
  assert.match(src, /<div>\n {10}<Button>Nav<\/Button>\n {10}<main className="mx-auto">\n {12}<Button variant="primary">Hero<\/Button>/);
  // a page with data or logic falls back to rendering as one component
  await ws.run({ op: "import_route", canvas: "demo", route: "/blog/[slug]", copy: true }, user);
  assert.match(read(), /import RoutePage from "@\/app\/\(site\)\/blog\/\[slug\]\/page";/);
  fs.rmSync(path.join(root, "app/(site)"), { recursive: true });
});

test("linked frames: layers are the page's JSX and edits write to the page and layout", async () => {
  reset();
  const dir = path.join(root, "app/(site)");
  fs.mkdirSync(path.join(dir, "blog/[slug]"), { recursive: true });
  const LAYOUT = `import { Button } from "@/components/button";\nexport default function L({ children }: { children: React.ReactNode }) {\n  return (\n    <>\n      <Button>Nav</Button>\n      <main className="mx-auto">{children}</main>\n    </>\n  );\n}\n`;
  const PAGE = `import { Button } from "@/components/button";\nimport { Card } from "@/components/card";\n\n/**\n * A comment that mentions Card.\n */\nconst Page = () => {\n    return (\n        <>\n            <Button variant="primary">Hero</Button>\n            <Card />\n        </>\n    );\n};\n\nexport default Page;\n`;
  fs.writeFileSync(path.join(dir, "layout.tsx"), LAYOUT);
  fs.writeFileSync(path.join(dir, "page.tsx"), PAGE);
  fs.writeFileSync(path.join(root, "components/card.tsx"), `export function Card() {\n  return <div>Card</div>;\n}\n`);
  fs.writeFileSync(path.join(dir, "blog/[slug]/page.tsx"), `export default async function P({ params }) { const { slug } = await params; return <h1>{slug}</h1>; }\n`);
  const pageFile = () => fs.readFileSync(path.join(dir, "page.tsx"), "utf8");
  const layoutFile = () => fs.readFileSync(path.join(dir, "layout.tsx"), "utf8");

  // ids of page files carry their path
  assert.match(injectIds(PAGE, "app/(site)/page.tsx"), /<Button data-tc="app\/\(site\)\/page\.tsx#10:12" variant="primary">/);

  await ws.run({ op: "import_route", canvas: "demo", route: "/" }, user);
  const canvasSrc = read();
  assert.match(canvasSrc, /import HomePage from "@\/app\/\(site\)\/page";/);
  assert.match(canvasSrc, /import SiteLayout from "@\/app\/\(site\)\/layout";/);
  assert.match(canvasSrc, /<Frame name="Home" x=\{1300\} y=\{0\} width=\{1440\} page="app\/\(site\)\/page\.tsx">\n\s+<SiteLayout>\n\s+<HomePage \/>\n\s+<\/SiteLayout>/);

  const home = ws.doc("demo").frames.find((f) => f.frameName === "Home");
  assert.deepEqual(home.link, { page: "app/(site)/page.tsx", route: "/", files: ["app/(site)/page.tsx", "app/(site)/layout.tsx"], editable: true });
  assert.deepEqual(home.children.map((c) => c.id), ["app/(site)/layout.tsx#5:6", "app/(site)/layout.tsx#6:6"]);
  const main = home.children[1];
  assert.deepEqual(main.children.map((c) => c.id), ["app/(site)/page.tsx#10:12", "app/(site)/page.tsx#11:12"]);

  // text edit: the page file changes, the canvas doesn't
  await ws.run({ op: "set_text", canvas: "demo", id: "app/(site)/page.tsx#10:12", text: "Welcome" }, user);
  assert.match(pageFile(), /<Button variant="primary">Welcome<\/Button>/);
  assert.equal(read(), canvasSrc);
  // insert into the frame: lands in the page, with the page's 4-space indentation
  const res = await ws.run({ op: "insert_jsx", canvas: "demo", parent: "Home", jsx: "<section>\n  <p>New</p>\n</section>" }, user);
  assert.match(pageFile(), /\n {12}<section>\n {16}<p>New<\/p>\n {12}<\/section>\n {8}<\/>/);
  assert.ok(res.ids[0].startsWith("app/(site)/page.tsx#"));
  // layout layers edit the layout
  await ws.run({ op: "set_class", canvas: "demo", id: "app/(site)/layout.tsx#6:6", className: "mx-auto max-w-5xl" }, user);
  assert.match(layoutFile(), /<main className="mx-auto max-w-5xl">\{children\}<\/main>/);
  // mixing files in one command is refused
  await assert.rejects(ws.run({ op: "move", canvas: "demo", id: "app/(site)/page.tsx#11:12", parent: "app/(site)/layout.tsx#6:6" }, user), /different files/);
  // undo restores the files, newest first
  await ws.undo("demo", user);
  assert.equal(layoutFile(), LAYOUT);
  await ws.undo("demo", user);
  await ws.undo("demo", user);
  assert.equal(pageFile(), PAGE);

  // a page layer can become a component: it moves out of page.tsx
  await ws.run({ op: "create_component", canvas: "demo", name: "HeroButton", from: "app/(site)/page.tsx#10:12" }, user);
  assert.match(pageFile(), /<HeroButton \/>/);
  assert.match(pageFile(), /import \{ HeroButton \} from "@\/components\/hero-button";/);
  // Card is still used by the page; Button moved out with the layer, so its import goes
  assert.match(pageFile(), /import \{ Card \} from "@\/components\/card";/);
  assert.doesNotMatch(pageFile(), /import \{ Button \}/);
  assert.match(fs.readFileSync(path.join(root, "components/hero-button.tsx"), "utf8"), /<Button variant="primary">Hero<\/Button>/);
  await ws.undo("demo", user);
  assert.equal(pageFile(), PAGE);
  fs.rmSync(path.join(root, "components/hero-button.tsx"));

  // explore a copy, change it, apply it back
  await ws.run({ op: "explore_copy", canvas: "demo", frame: "Home" }, user);
  const copy = ws.doc("demo").frames.find((f) => f.frameName === "Home exploration");
  assert.equal(copy.from, "app/(site)/page.tsx");
  assert.equal(copy.link, null);
  assert.equal(copy.x, 1300 + 1440 + 80);
  const hero = (function find(n) {
    if (n.kind === "text" && n.text === "Hero") return n;
    for (const c of n.children) {
      const f = find(c);
      if (f) return f;
    }
    return null;
  })(copy);
  assert.ok(!hero.id.includes("#"));
  await ws.run({ op: "set_text", canvas: "demo", id: hero.id, text: "Explored" }, user);
  const card = ws.doc("demo").frames.find((f) => f.frameName === "Home exploration").children[0].children.find((n) => n.name === "Card");
  await ws.run({ op: "delete", canvas: "demo", ids: [card.id] }, user);
  await ws.run({ op: "apply_to_page", canvas: "demo", frame: "Home exploration" }, user);
  // the page keeps its 4-space style; Card's import goes (the comment mentioning it doesn't count)
  // one element left: written without a fragment
  assert.match(pageFile(), /return \(\n {8}<Button variant="primary">Explored<\/Button>\n {4}\);/);
  assert.match(pageFile(), /^import \{ Button \} from "@\/components\/button";\n\n\/\*\*/);
  assert.equal(layoutFile(), LAYOUT);
  await ws.undo("demo", user);
  assert.equal(pageFile(), PAGE);

  // a page with data or logic is view only
  await ws.run({ op: "import_route", canvas: "demo", route: "/blog/[slug]" }, user);
  const blog = ws.doc("demo").frames.find((f) => f.page?.includes("blog"));
  assert.equal(blog.link.editable, false);
  // the layout stays editable; the page renders as one canvas layer inside main
  const layer = blog.children[1].children[0];
  assert.equal(layer.name, "SlugPage");
  await assert.rejects(ws.run({ op: "set_props", canvas: "demo", id: layer.id, props: { className: "x" } }, user), /view only/);
  fs.rmSync(dir, { recursive: true });
});

test("compare: linked pages are snapshotted with the canvas", async () => {
  const { writeCompare } = await import("../dist/core/index.js");
  const config = loadConfig(root);
  const src = `"use client";\nimport { Canvas, Frame } from "truecanvas";\nimport HomePage from "@/app/(site)/page";\nexport default function C() {\n  return (\n    <Canvas>\n      <Frame name="Home" x={0} y={0} width={800} page="app/(site)/page.tsx">\n        <HomePage />\n      </Frame>\n    </Canvas>\n  );\n}\n`;
  writeCompare(config, "demo", src, { "app/(site)/page.tsx": `import { Button } from "../../components/button";\nexport default function P() { return <Button>Old</Button>; }\n` });
  const dir = path.join(root, "app/truecanvas/compare");
  const snap = fs.readFileSync(path.join(dir, "demo.canvas.tsx"), "utf8");
  assert.match(snap, /import HomePage from "\.\/demo--app_site_page";/);
  const page = fs.readFileSync(path.join(dir, "demo--app_site_page.tsx"), "utf8");
  assert.match(page, /from "\.\.\/\.\.\/\.\.\/components\/button"/);
});

test("motion: reveal and text animations wrap layers and add the components once", async () => {
  reset();
  const run = (cmd) => ws.run({ canvas: "demo", ...cmd }, user);
  const cancel = idOf((n) => n.name === "Button" && n.children[0]?.text === "Cancel");
  let res = await run({ op: "add_animation", id: cancel, kind: "reveal", effect: "blur-in", delay: 0.2 });
  assert.ok(fs.existsSync(path.join(root, "components/motion/reveal.tsx")));
  assert.ok(fs.existsSync(path.join(root, "components/motion/text-animate.tsx")));
  assert.match(read(), /import \{ Reveal \} from "@\/components\/motion\/reveal";/);
  assert.match(read(), /<Reveal effect="blur-in" delay=\{0\.2\}>\n {12}<Button>Cancel<\/Button>\n {10}<\/Reveal>/);
  // the selection stays on the layer, and applying again updates the same wrapper
  const selected = ws.doc("demo");
  assert.equal(findNodeById(selected, res.ids[0]).name, "Button");
  await run({ op: "add_animation", id: res.ids[0], kind: "reveal", effect: "scale-in" });
  assert.match(read(), /<Reveal effect="scale-in" delay=\{0\.2\}>/);
  assert.equal(read().match(/<Reveal/g).length, 1);

  // text: the element's children are wrapped
  const p = idOf((n) => n.name === "p");
  res = await run({ op: "add_animation", id: p, kind: "text", effect: "letters", stagger: 0.03 });
  assert.match(read(), /<p><TextAnimate effect="letters" stagger=\{0\.03\}>Hello \{"world"\}<\/TextAnimate><\/p>/);
  // components without text here are refused with a hint
  await assert.rejects(run({ op: "add_animation", id: idOf((n) => n.name === "Button" && n.props.size), kind: "text" }), /no text of its own/);

  // removing unwraps and drops the import when unused
  await run({ op: "remove_animation", id: idOf((n) => n.name === "p"), kind: "text" });
  await run({ op: "remove_animation", id: idOf((n) => n.name === "Button" && n.children[0]?.text === "Cancel"), kind: "reveal" });
  assert.doesNotMatch(read(), /Reveal|TextAnimate/);
  assert.match(read(), /<Button>Cancel<\/Button>/);
  assert.match(read(), /<p>Hello \{"world"\}<\/p>/);
  fs.rmSync(path.join(root, "components/motion"), { recursive: true });
});

function findNodeById(doc, id) {
  const stack = [...doc.frames];
  while (stack.length) {
    const n = stack.pop();
    if (n.id === id) return n;
    stack.push(...n.children);
  }
  return null;
}

test("components: main component frames edit the component file, cn() classes stay merged", async () => {
  reset();
  const CARD = `import { cn } from "@/lib/cn";\nimport { Button } from "@/components/button";\n\nexport function Card({ title, className }: { title: string; className?: string }) {\n  const big = title.length > 20;\n  return (\n    <div className={cn("rounded-xl border p-4", className)}>\n      <h3 className="font-semibold">{title}</h3>\n      <p>Static copy</p>\n      <Button>Go</Button>\n    </div>\n  );\n}\n`;
  fs.mkdirSync(path.join(root, "lib"), { recursive: true });
  fs.writeFileSync(path.join(root, "lib/cn.ts"), `export const cn = (...a: unknown[]) => a.filter(Boolean).join(" ");\n`);
  fs.writeFileSync(path.join(root, "components/card.tsx"), CARD);
  const card = () => fs.readFileSync(path.join(root, "components/card.tsx"), "utf8");
  ws.catalog.invalidate();
  await ws.catalog.load();

  await ws.run({ op: "add_component_frame", canvas: "demo", component: "Card" }, user);
  assert.match(read(), /<Frame name="Card" x=\{\d+\} y=\{0\} width=\{640\} component="components\/card\.tsx#Card">/);
  // opening it again reuses the frame
  await ws.run({ op: "add_component_frame", canvas: "demo", component: "Card" }, user);
  assert.equal(read().match(/component="components\/card\.tsx#Card"/g).length, 1);
  const frame = ws.doc("demo").frames.find((f) => f.frameName === "Card");
  assert.deepEqual(frame.link, { kind: "component", page: "components/card.tsx", route: "Card", files: ["components/card.tsx"], editable: true });
  const rootNode = frame.children[0];
  assert.equal(rootNode.id, "components/card.tsx#7:4");
  assert.deepEqual(rootNode.props.className, { kind: "string", value: "rounded-xl border p-4" });

  // class edit replaces the static part of cn(...), keeps the merge
  await ws.run({ op: "set_class", canvas: "demo", id: rootNode.id, className: "rounded-2xl border p-6 shadow-sm" }, user);
  assert.match(card(), /className=\{cn\("rounded-2xl border p-6 shadow-sm", className\)\}/);
  // literal text edits, inserts into the frame land in the component root
  await ws.run({ op: "set_text", canvas: "demo", id: "components/card.tsx#t9:9", text: "New copy" }, user);
  assert.match(card(), /<p>New copy<\/p>/);
  await ws.run({ op: "insert_jsx", canvas: "demo", parent: "Card", jsx: '<span className="text-xs">Badge</span>' }, user);
  assert.match(card(), /<Button>Go<\/Button>\n      <span className="text-xs">Badge<\/span>\n    <\/div>/);
  // {title} is code: read-only
  const h3 = ws.doc("demo").frames.find((f) => f.frameName === "Card").children[0].children[0];
  assert.equal(h3.children[0].kind, "expression");
  // the logic before the return is untouched
  assert.match(card(), /const big = title\.length > 20;/);
  fs.rmSync(path.join(root, "components/card.tsx"));
  fs.rmSync(path.join(root, "lib"), { recursive: true });
});

test("components: create a component, new or from selected layers", async () => {
  reset();
  // new, inserted into a container
  const stack = idOf((n) => n.name === "div");
  await ws.run({ op: "create_component", canvas: "demo", name: "pricing card", parent: stack, index: 0 }, user);
  const file = path.join(root, "components/pricing-card.tsx");
  assert.match(fs.readFileSync(file, "utf8"), /export function PricingCard\(\) \{\n  return \(\n    <div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-6">/);
  assert.match(read(), /import \{ PricingCard \} from "@\/components\/pricing-card";/);
  assert.match(read(), /<div className="flex flex-col gap-2 p-4">\n {10}<PricingCard \/>/);
  // from selection: the layers move out, their imports come along
  const save = idOf((n) => n.name === "Button" && n.children[0]?.text === "Save");
  await ws.run({ op: "create_component", canvas: "demo", name: "SaveButton", from: save }, user);
  const made = fs.readFileSync(path.join(root, "components/save-button.tsx"), "utf8");
  assert.match(made, /^import \{ Button \} from "@\/components\/button";/);
  assert.match(made, /<Button variant="primary">Save<\/Button>/);
  assert.match(read(), /<SaveButton \/>/);
  // Button is still used by the other layers, so its import stays
  assert.match(read(), /import \{ Button \} from "@\/components\/button";/);
  await assert.rejects(ws.run({ op: "create_component", canvas: "demo", name: "SaveButton" }, user), /already/);
  await assert.rejects(ws.run({ op: "create_component", canvas: "demo", name: "123" }, user), /can't be a component name/);
  fs.rmSync(file);
  fs.rmSync(path.join(root, "components/save-button.tsx"));
});

test("insert into an element with nothing between its tags", async () => {
  reset();
  const { CanvasEditor, parseCanvas: parse } = await import("../dist/core/index.js");
  const src = `export default function C() {\n  return <Canvas></Canvas>;\n}\n`;
  const doc = parse("x", "x", src);
  const ed = new CanvasEditor(src, doc);
  ed.insertFrame('<Frame name="A" x={0} y={0} width={100}>\n  <p>Hi</p>\n</Frame>');
  assert.match(ed.result(), /<Canvas>\n {4}<Frame name="A" x=\{0\} y=\{0\} width=\{100\}>\n {6}<p>Hi<\/p>\n {4}<\/Frame>\n {2}<\/Canvas>/);
});

test("first imports of a file keep their order and a blank line before the code", async () => {
  const { CanvasEditor, parseCanvas: parse } = await import("../dist/core/index.js");
  const src = `export default function C() {\n  return <Canvas></Canvas>;\n}\n`;
  const ed = new CanvasEditor(src, parse("x", "x", src));
  ed.ensureImport("A", "@/a");
  ed.ensureImport("B", "@/b");
  assert.ok(ed.result().startsWith(`import { A } from "@/a";\nimport { B } from "@/b";\n\nexport default`));
});

test("set_props: new props survive changing or removing the last attribute in the same call", async () => {
  reset();
  const side = idOf((n) => n.name === "Button" && n.props.size);
  await ws.run({ op: "set_props", canvas: "demo", id: side, props: { variant: "ghost", className: "w-full" } }, user);
  assert.match(read(), /<Button size="sm" disabled className="w-full" variant="ghost" \/>/);
  const again = idOf((n) => n.name === "Button" && n.props.size);
  await ws.run({ op: "set_props", canvas: "demo", id: again, props: { className: null, title: "Save" } }, user);
  assert.match(read(), /<Button size="sm" disabled variant="ghost" title="Save" \/>/);
});

test("icons: installed libraries render to SVG, insert with an import, alias on name clashes", async () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-icons-"));
  fs.mkdirSync(path.join(proj, "canvas"));
  fs.mkdirSync(path.join(proj, "node_modules/lucide-react"), { recursive: true });
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ dependencies: { "lucide-react": "1.0.0" } }));
  for (const dep of ["react", "react-dom"]) fs.symlinkSync(path.resolve(`../../examples/playground/node_modules/${dep}`), path.join(proj, "node_modules", dep), "junction");
  // shaped like lucide: icons plus `XIcon` and `LucideX` aliases and a generic `Icon`
  fs.writeFileSync(path.join(proj, "node_modules/lucide-react/package.json"), JSON.stringify({ name: "lucide-react", version: "1.0.0", type: "module", main: "index.js" }));
  fs.writeFileSync(
    path.join(proj, "node_modules/lucide-react/index.js"),
    `import { createElement as h } from "react";
const make = (d) => (props) => h("svg", { viewBox: "0 0 24 24", className: "lucide", ...props }, h("path", { d }));
export const Search = make("M11 11m-8 0a8 8 0 1 0 16 0");
export const House = make("M3 10l9-7 9 7");
export const SearchIcon = Search;
export const LucideSearch = Search;
export const Icon = make("M0 0");
export const icons = { Search, House };`,
  );
  fs.writeFileSync(
    path.join(proj, "canvas/demo.canvas.tsx"),
    `"use client";
import { Canvas, Frame } from "truecanvas";

function Search() {
  return <input />;
}

export default function Demo() {
  return (
    <Canvas>
      <Frame name="Main" x={0} y={0} width={400}>
        <div className="flex gap-2">
          <Search />
        </div>
      </Frame>
    </Canvas>
  );
}
`,
  );
  const lib = iconLibraries(proj).find((l) => l.id === "lucide");
  assert.equal(lib.version, "1.0.0");
  const icons = await loadIcons(proj, "lucide");
  assert.deepEqual(icons.map((i) => i.name), ["House", "Search"], "aliases and non-icons dropped");
  assert.match(icons[1].svg, /^<svg[^>]*viewBox="0 0 24 24"/);
  assert.doesNotMatch(icons[1].svg, /class=/, "classes stripped from previews");
  assert.deepEqual(searchIcons(icons, "sea").icons.map((i) => i.name), ["Search"]);

  const pws = new Workspace(loadConfig(proj));
  const doc = () => fs.readFileSync(path.join(proj, "canvas/demo.canvas.tsx"), "utf8");
  // ids shift when an import line is added: read the container's id before each edit
  const stack = () => parseCanvas("demo", "canvas/demo.canvas.tsx", doc()).frames[0].children[0].id;
  // the canvas declares its own Search: lucide's comes in as SearchIcon
  await pws.run({ op: "insert_icon", canvas: "demo", parent: stack(), library: "lucide", name: "search" }, user);
  assert.match(doc(), /import \{ Search as SearchIcon \} from "lucide-react";/);
  assert.match(doc(), /<SearchIcon className="size-4" \/>/);
  assert.match(doc(), /<Search \/>/, "the local Search is untouched");
  // a second icon joins the same import
  await pws.run({ op: "insert_icon", canvas: "demo", parent: stack(), library: "lucide-react", name: "House", className: "size-5 text-muted" }, user);
  assert.match(doc(), /import \{ Search as SearchIcon, House \} from "lucide-react";/);
  assert.match(doc(), /<House className="size-5 text-muted" \/>/);
  await assert.rejects(pws.run({ op: "insert_icon", canvas: "demo", parent: stack(), library: "lucide", name: "Serch" }, user), /No icon "Serch".*Did you mean Search/);
  await assert.rejects(pws.run({ op: "insert_icon", canvas: "demo", parent: stack(), library: "nope", name: "X" }, user), /Unknown icon library/);
});

test("shadcn: status reads components.json and the ui folder through the import alias", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-shadcn-"));
  fs.writeFileSync(path.join(proj, "package.json"), "{}");
  assert.deepEqual(shadcnStatus(proj), { initialized: false, uiDir: null, installed: [] });
  fs.writeFileSync(path.join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }));
  fs.writeFileSync(path.join(proj, "components.json"), JSON.stringify({ aliases: { ui: "@/components/ui" } }));
  fs.mkdirSync(path.join(proj, "src/components/ui"), { recursive: true });
  for (const f of ["button.tsx", "card.tsx", "utils.ts"]) fs.writeFileSync(path.join(proj, "src/components/ui", f), "");
  assert.deepEqual(shadcnStatus(proj), { initialized: true, uiDir: path.join("src", "components", "ui"), installed: ["button", "card"] });
});

test("git: status keeps unusual paths intact, reports renames and conflicts, rejects option-like refs", async () => {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-git-"));
  const g = (...args) => execFileSync("git", args, { cwd: repo, stdio: "pipe", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
  g("init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "old.txt"), "a\n");
  fs.writeFileSync(path.join(repo, "both.txt"), "base\n");
  g("add", ".");
  g("commit", "-qm", "base");
  g("switch", "-qc", "other");
  fs.writeFileSync(path.join(repo, "both.txt"), "theirs\n");
  g("commit", "-qam", "theirs");
  g("switch", "-q", "main");
  fs.writeFileSync(path.join(repo, "both.txt"), "ours\n");
  g("commit", "-qam", "ours");
  try {
    g("merge", "-q", "other");
  } catch {
    // conflict expected
  }
  g("mv", "old.txt", "new name.txt");
  fs.writeFileSync(path.join(repo, "café.canvas.tsx"), "x");
  // reached through a symlink, like macOS's /var → /private/var: git reports real paths
  const link = `${repo}-link`;
  fs.symlinkSync(repo, link, "junction");
  const status = await new Git(link).status();
  const byPath = Object.fromEntries(status.files.map((f) => [f.path, f.status]));
  assert.equal(byPath["café.canvas.tsx"], "untracked");
  assert.equal(byPath["new name.txt"], "renamed");
  assert.equal(byPath["both.txt"], "conflicted");
  assert.equal(Object.keys(byPath).length, 3, JSON.stringify(byPath));
  assert.equal(await new Git(link).show("HEAD", "both.txt"), "ours\n", "show() reads through the symlink too");
  await assert.rejects(new Git(repo).show("--output=/tmp/x", "both.txt"), /Invalid git ref/);
  await assert.rejects(new Git(repo).switch("-b"), /Invalid git ref/);
});

test("init: wraps only the exported next.config expression", () => {
  const imp = `import { withTruecanvas } from "truecanvas/next";`;
  const a = wrapConfigExport(`const nextConfig = {};\nexport default nextConfig;\n\n// see docs\n`);
  assert.ok(a.includes("export default withTruecanvas(nextConfig);\n\n// see docs\n"), a);
  assert.ok(a.includes(imp));
  const b = wrapConfigExport(`export default function config(phase) {\n  return {};\n}\n`);
  assert.match(b, /^import \{ withTruecanvas \}[\s\S]*function config\(phase\) \{\n  return \{\};\n\}\n\nexport default withTruecanvas\(config\);/);
  const c = wrapConfigExport(`export default (phase) => ({ reactStrictMode: true });\n`);
  assert.match(c, /export default withTruecanvas\(\(phase\) => \(\{ reactStrictMode: true \}\)\);/);
  const d = wrapConfigExport(`/** @type {import('next').NextConfig} */\nmodule.exports = { images: {} };\n// trailing\n`);
  assert.match(d, /^const \{ withTruecanvas \} = require\("truecanvas\/next"\);\n/);
  assert.match(d, /module\.exports = withTruecanvas\(\{ images: \{\} \}\);\n\/\/ trailing\n$/);
  assert.equal(wrapConfigExport(`const x = 1;\n`), null);
});

test("vite: adds truecanvas() to the plugins, keeping the config's style", () => {
  const imp = `import { truecanvas } from "truecanvas/vite";`;
  const multi = addVitePlugin(`import react from '@vitejs/plugin-react'\nimport { defineConfig } from 'vite'\n\nexport default defineConfig({\n  plugins: [\n    react(),\n  ],\n})\n`);
  assert.ok(multi.includes(imp), multi);
  assert.ok(multi.includes(`  plugins: [\n    react(),\n    truecanvas(),\n  ],`), multi);
  const inline = addVitePlugin(`import { defineConfig } from "vite";\nexport default defineConfig(({ mode }) => ({ plugins: [react()], base: "/" }));\n`);
  assert.ok(inline.includes(`plugins: [react(), truecanvas()]`), inline);
  assert.ok(addVitePlugin(`export default { plugins: [] };\n`).includes(`plugins: [truecanvas()]`));
  assert.equal(addVitePlugin(`export default {};\n`), null, "no plugins array: the user adds it by hand");
});

test("vite: detected, set up, and frames get the app's stylesheets", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-vite-"));
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ name: "v", scripts: { dev: "vite" }, dependencies: { react: "19.0.0" }, devDependencies: { vite: "8.0.0" } }));
  fs.writeFileSync(path.join(proj, "vite.config.ts"), `import { defineConfig } from "vite";\nexport default defineConfig({\n  plugins: [react()],\n});\n`);
  fs.writeFileSync(path.join(proj, "index.html"), `<html><head><link rel="preconnect" href="https://fonts.gstatic.com"></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`);
  fs.mkdirSync(path.join(proj, "src", "components"), { recursive: true });
  fs.writeFileSync(path.join(proj, "src/main.tsx"), `import { createRoot } from "react-dom/client";\nimport "./index.css";\nimport "@fontsource/inter";\nimport App from "./App";\n`);
  const config = loadConfig(proj);
  assert.deepEqual([config.framework, config.appDir, config.routeDir, config.canvasDir, config.appUrl], ["vite", "src", ".truecanvas", "src/canvas", "http://localhost:5173"]);
  assert.deepEqual(viteStylesheets(proj), ["/src/index.css"], "the entry's own stylesheets (package CSS without an extension is skipped)");
  assert.equal(configStatus(proj).wrapped, false);
  const report = initProject(config);
  assert.ok(report.done.some((l) => l.includes("truecanvas() plugin")), JSON.stringify(report));
  assert.equal(configStatus(proj).wrapped, true);
  assert.match(fs.readFileSync(path.join(proj, ".gitignore"), "utf8"), /^\/\.truecanvas\/$/m);
  syncRoute(config);
  const entry = fs.readFileSync(path.join(proj, ".truecanvas/entry.tsx"), "utf8");
  assert.match(entry, /^import "\/src\/index\.css";$/m);
  assert.match(entry, /getElementById\("tc-root"\)/);
  assert.ok(!fs.existsSync(path.join(proj, ".truecanvas/[canvas]")), "no Next route in a Vite app");
});

test("vite plugin: stamps canvases and components, nothing else", () => {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-vplug-"));
  fs.writeFileSync(path.join(proj, "package.json"), JSON.stringify({ devDependencies: { vite: "8.0.0" } }));
  fs.mkdirSync(path.join(proj, "src"));
  const plugin = vitePlugin();
  plugin.configResolved({ root: proj });
  const jsx = `export const A = () => <div><span>hi</span></div>;\n`;
  assert.match(plugin.transform(jsx, path.join(proj, "src/canvas/home.canvas.tsx")).code, /<div data-tc="1:23">/);
  assert.match(plugin.transform(jsx, path.join(proj, "src/components/a.tsx") + "?v=1").code, /data-tc="src\/components\/a\.tsx#1:23"/);
  assert.equal(plugin.transform(jsx, path.join(proj, "src/App.tsx")), null);
  assert.equal(plugin.transform(jsx, path.join(proj, "node_modules/x/src/components/a.tsx")), null);
  assert.equal(plugin.apply, "serve", "production builds are untouched");
});

/** An isolated project with one canvas; `id(pred)` finds a layer's current id. */
function project(canvasBody, files = {}) {
  const proj = fs.mkdtempSync(path.join(os.tmpdir(), "truecanvas-fix-"));
  for (const dir of ["canvas", "components", "app"]) fs.mkdirSync(path.join(proj, dir));
  fs.writeFileSync(path.join(proj, "package.json"), "{}");
  fs.writeFileSync(path.join(proj, "tsconfig.json"), JSON.stringify({ compilerOptions: { jsx: "react-jsx", strict: true, paths: { "@/*": ["./*"] } } }));
  fs.symlinkSync(path.resolve("../../examples/playground/node_modules"), path.join(proj, "node_modules"), "junction");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(proj, rel)), { recursive: true });
    fs.writeFileSync(path.join(proj, rel), content);
  }
  const canvasFile = path.join(proj, "canvas/demo.canvas.tsx");
  fs.writeFileSync(canvasFile, canvasBody.includes("<Canvas>") ? canvasBody : `"use client";\nimport { Canvas, Frame } from "truecanvas";\n\nexport default function Demo() {\n  return (\n    <Canvas>\n      <Frame name="Main" x={0} y={0} width={400}>\n${canvasBody}\n      </Frame>\n    </Canvas>\n  );\n}\n`);
  const w = new Workspace(loadConfig(proj));
  const read = () => fs.readFileSync(canvasFile, "utf8");
  const nodes = () => {
    const out = [];
    const walk = (n) => {
      out.push(n);
      n.children.forEach(walk);
    };
    parseCanvas("demo", "canvas/demo.canvas.tsx", read()).frames.forEach(walk);
    return out;
  };
  const id = (pred) => nodes().find(pred)?.id;
  return { proj, ws: w, read, id, canvasFile };
}

test("security: ids can't reach files the canvas doesn't show, canvas names can't be paths", async () => {
  const { proj, ws: w, id } = project(`        <p>Hi</p>`);
  const outside = path.join(path.dirname(proj), `outside-${path.basename(proj)}.tsx`);
  fs.writeFileSync(outside, "export default function X() { return <p>safe</p>; }\n");
  const evil = `${path.relative(proj, outside)}#1:41`;
  await assert.rejects(w.run({ op: "set_text", canvas: "demo", id: evil, text: "PWNED" }, user), /isn't shown on this canvas/);
  assert.match(fs.readFileSync(outside, "utf8"), /safe/);
  assert.deepEqual(w.comments.list("../../etc/x"), [], "reads nothing outside the canvas folder");
  assert.throws(() => w.comments.add("../../../tmp/x", { frame: "Main", x: 0, y: 0, text: "hi", author: { kind: "user", name: "t" } }), /Invalid canvas name/);
  void id;
});

test("edits keep content intact: $ in copied pages, JSX comments, multi-line strings, generics", async () => {
  const page = `export default function Pricing() {\n  return (\n    <main>\n      <p>Plans from $$ to $$$, or $& off</p>\n    </main>\n  );\n}\n`;
  const { ws: w, read, id } = project(
    `        <div className="a">
          <p>{/* legal: keep wording */}Hello</p>
          <pre>{\`line1
  indented
line3\`}</pre>
          <List<string> items={[]} />
        </div>
        <section className="b" />`,
    { "app/pricing/page.tsx": page, "components/list.tsx": "export function List<T>({ items }: { items: T[] }) { return <ul />; }\n" },
  );
  await w.run({ op: "import_route", canvas: "demo", route: "/pricing", copy: true }, user);
  assert.ok(read().includes("Plans from $$ to $$$, or $& off"), "dollar sequences stay literal");

  await w.run({ op: "set_text", canvas: "demo", id: id((n) => n.name === "p" && n.children.some((c) => c.kind === "text" && /Hello/.test(c.text ?? c.value ?? ""))) ?? id((n) => n.name === "p"), text: "Hi" }, user);
  assert.match(read(), /<p>\{\/\* legal: keep wording \*\/\}Hi<\/p>/);

  const section = () => id((n) => n.name === "section");
  await w.run({ op: "move", canvas: "demo", id: id((n) => n.name === "pre"), parent: section() }, user);
  assert.ok(read().includes("{`line1\n  indented\nline3`}"), "template literal content unchanged");

  await w.run({ op: "move", canvas: "demo", id: id((n) => n.name === "List"), parent: section() }, user);
  assert.match(read(), /<List<string> items=\{\[\]\} \/>/);
});

test("duplicate several siblings selects the copies; create_component alone adds no import", async () => {
  const { ws: w, read, id, proj } = project(`        <div>\n          <h1>A</h1>\n          <h2>B</h2>\n        </div>`);
  const res = await w.run({ op: "duplicate", canvas: "demo", ids: [id((n) => n.name === "h1"), id((n) => n.name === "h2")] }, user);
  const kids = parseCanvas("demo", "canvas/demo.canvas.tsx", read()).frames[0].children[0].children.filter((c) => c.kind !== "text");
  assert.deepEqual(kids.map((k) => k.name), ["h1", "h1", "h2", "h2"]);
  assert.deepEqual([...res.ids].sort(), [kids[1].id, kids[3].id].sort(), "the two copies are selected");

  const before = read();
  await w.run({ op: "create_component", canvas: "demo", name: "PricingCard" }, user);
  assert.equal(read(), before, "no unused import in the canvas");
  assert.ok(fs.readdirSync(path.join(proj, "components")).some((f) => /pricing-card/i.test(f)), "the component file is written");
});

test("CRLF files stay CRLF and deletes leave no blank lines", async () => {
  const { ws: w, read, id, canvasFile } = project(`        <div>\n          <h1>A</h1>\n          <p>B</p>\n        </div>`);
  fs.writeFileSync(canvasFile, read().replace(/\n/g, "\r\n"));
  const w2 = new Workspace(loadConfig(path.dirname(path.dirname(canvasFile))));
  await w2.run({ op: "delete", canvas: "demo", ids: [id((n) => n.name === "h1")] }, user);
  const out = read();
  assert.ok(!/(^|[^\r])\n/.test(out), "every line ending is CRLF");
  assert.ok(!/\r\n[ \t]*\r\n[ \t]*<p>/.test(out), "no blank line left where h1 was");
  assert.match(out, /<div>\r\n {10}<p>B<\/p>/);
  void w;
});

test("server: serves the editor and its assets, refuses paths outside, binds to localhost", async () => {
  const { proj } = project(`        <p>Hi</p>`);
  const port = 4950 + Math.floor(Math.random() * 40);
  const { spawn } = await import("node:child_process");
  const child = spawn(process.execPath, [path.resolve("dist/cli.js"), "dev", "--no-next", "--no-open", "--port", String(port)], { cwd: proj, stdio: "ignore" });
  try {
    const base = `http://127.0.0.1:${port}`;
    let html = "";
    for (let i = 0; i < 60 && !html; i++) {
      html = await fetch(base).then((r) => r.text()).catch(() => "");
      if (!html) await new Promise((r) => setTimeout(r, 200));
    }
    const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
    assert.ok(script, "index.html references a script");
    const res = await fetch(base + script);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /javascript/, "assets are served as JS, not the index fallback");
    const escape = await fetch(`${base}/..%2f..%2fpackage.json`).then((r) => r.text());
    assert.doesNotMatch(escape, /"name"/, "no file outside the editor bundle");
    const foreign = await fetch(`${base}/api/state`, { headers: { origin: "https://evil.example" } });
    assert.equal(foreign.status, 403, "other origins are refused");
  } finally {
    child.kill();
  }
});
