import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Workspace, Command, Actor, Presence } from "../core/workspace.js";
import { findByPath, findNode } from "../core/parse.js";
import { assertCanvasName } from "../core/scaffold.js";
import { ICON_LIBRARIES, iconLibraries, loadIcons, searchIcons } from "../core/icons.js";
import { addShadcnComponents, installIconLibrary, libraryState } from "../core/libraries.js";
import { describeComponent, outlineDoc } from "../core/outline.js";
import { readDesignTokens } from "../core/tokens.js";
import { DEVICES, findDevice } from "../core/devices.js";
import type { Screenshotter } from "./screenshot.js";
import { createSnapshot } from "../share/snapshot.js";
import { parseEmails, publishSnapshot, reviewSite, siteFeatures, type LiveSite } from "../share/publish.js";
import { canExport, exportSite } from "../share/export.js";
import type { ShotService } from "./shot.js";
import { newShot, normalizeShot, SHOT_FORMATS, SHOT_SHADERS, type Shot } from "../core/shot-model.js";
import { readTokenData } from "../core/tokens.js";
import type { Sessions } from "../share/session.js";

export const INSTRUCTIONS = `Truecanvas is a design canvas whose layers are the project's real React components.
A canvas is a .tsx file (canvas/<name>.canvas.tsx) with <Frame> artboards; every edit you make is written to that file as clean TSX and appears live in the user's editor window.

Workflow:
1. list_canvases → get_canvas to read the tree. Every node shows an id like [24:10] (line:col). Ids change after every edit, so use the ids returned by the latest call.
2. list_components / get_component to learn the design system's props, and get_design_tokens for the Tailwind theme (colors, radius, fonts). Prefer composing existing components over raw HTML. Layout wrappers are plain <div>s with Tailwind classes (flex, gap-*, p-*) using those tokens.
3. Edit with set_props, set_text, insert_jsx, replace_node, move_node, wrap_nodes, create_frame, update_frame. Imports for catalog components are added automatically.
   Library components (e.g. Paper shaders like MeshGradient) are in the catalog too: add_background puts one behind a frame or layer, apply_preset applies a named look. Array props are plain literals: colors={["#fff", "#000"]}.
   For mobile screens create frames with a device (e.g. device="iphone-16"): the right size, plus touch + pixel-ratio emulation in screenshots.
   Icons and shadcn/ui: list_libraries shows what's installed. install_library adds an icon set (lucide, tabler, phosphor, heroicons, radix); search_icons finds names and insert_icon places one with its import. add_shadcn_components copies shadcn/ui components into the project (setting shadcn up if needed); they then appear in list_components like any project component.
4. screenshot_frame to check the result visually. get_selection tells you what the user has selected in the editor ("make this denser" = the selection).
5. focus to show the user what you changed. Everything is undoable by the user.

Posting a design (X, LinkedIn): make_shot stages a frame on a shader or gradient backdrop at a social format and exports a PNG to shots/. Look at the preview it returns and adjust (colors, framing, crop) until it looks right.`;

const literal = z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number(), z.boolean()]))]);
const deviceIds = DEVICES.map((d) => d.id) as [string, ...string[]];

export function createMcpServer(ws: Workspace, shots: Screenshotter, session: () => string, sessions?: Sessions, shotService?: ShotService) {
  const server = new McpServer({ name: "truecanvas", version: "0.1.0" }, { instructions: INSTRUCTIONS });

  const actor = (): Actor => {
    const name = server.server.getClientVersion()?.name ?? "agent";
    ws.touchAgent(session(), name);
    return { kind: "agent", name };
  };
  const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
  const fail = (err: unknown) => ({ content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true });

  // Default canvas for this session: the last one the agent touched, so a user switching
  // canvases in the editor never redirects an agent's edits (ids are only line:col).
  let lastCanvas: string | null = null;
  const resolveCanvas = (canvas?: string) => {
    const c = canvas ?? lastCanvas ?? ws.selection.canvas ?? ws.canvases()[0];
    if (!c) throw new Error("No canvases yet. Use create_canvas.");
    assertCanvasName(c);
    lastCanvas = c;
    return c;
  };

  /** Live cursor in the editor: where the agent is and what it is doing. */
  const presence = (canvas: string, action: Presence["action"], label: string, ids: string[] = [], frame: string | null = null) => {
    const a = actor();
    ws.emit({ type: "presence", presence: { session: session(), name: a.kind === "agent" ? a.name : "agent", canvas, action, label, ids, frame, at: Date.now() } });
  };

  const VERBS: Partial<Record<Command["op"], string>> = {
    set_props: "Editing props",
    set_text: "Writing text",
    set_class: "Adjusting layout",
    insert_jsx: "Inserting",
    insert_component: "Inserting",
    insert_icon: "Inserting",
    replace: "Rewriting",
    duplicate: "Duplicating",
    delete: "Deleting",
    move: "Moving",
    reorder: "Moving",
    wrap: "Wrapping in auto layout",
    create_frame: "Creating a frame",
    update_frame: "Updating frame",
    create_variants: "Building variants",
    add_background: "Adding a background",
    apply_preset: "Applying a preset",
    import_route: "Linking a page",
    explore_copy: "Exploring a copy",
    apply_to_page: "Applying to the page",
    add_animation: "Animating",
    create_component: "Creating a component",
    add_component_frame: "Opening a component",
    remove_animation: "Removing an animation",
  };

  async function edit(make: () => Command) {
    let cmd: Command;
    try {
      cmd = make();
    } catch (err) {
      return fail(err);
    }
    try {
      // move the cursor to the target first, then edit
      const c = cmd as Record<string, unknown>;
      const before = [c.id, ...(Array.isArray(c.ids) ? c.ids : []), c.parent].filter((x): x is string => typeof x === "string");
      const frameRef = typeof c.frame === "string" ? c.frame : null;
      // layer ids are line:col, or file#line:col on a linked page; anything else names a frame
      const isLayerId = (x: string) => /^(?:.+#)?t?\d+:\d+$/.test(x);
      presence(cmd.canvas, "editing", `${VERBS[cmd.op] ?? "Editing"}…`, before.filter(isLayerId), frameRef ?? before.find((x) => !isLayerId(x)) ?? null);
      const res = await ws.run(cmd, actor());
      presence(cmd.canvas, "editing", res.label, res.ids);
      const frames = new Set<string>();
      for (const id of res.ids) {
        const hit = findNode(res.doc, id);
        if (hit) frames.add(hit.frame.frameName);
      }
      const outline = frames.size ? [...frames].map((f) => outlineDoc(res.doc, { frame: f }).split("\n").slice(1).join("\n")).join("\n") : "";
      return text(`✓ ${res.label} in ${cmd.canvas}${res.ids.length ? ` → ${res.ids.map((i) => `[${i}]`).join(" ")}` : ""}${outline ? `\n\nUpdated frame (ids are fresh):\n${outline}` : ""}`);
    } catch (err) {
      return fail(err);
    }
  }

  const canvasArg = { canvas: z.string().optional().describe("Canvas name. Defaults to the canvas open in the editor.") };

  server.registerTool(
    "list_canvases",
    { title: "List canvases", description: "List canvas files with their frames.", annotations: { readOnlyHint: true } },
    async () => {
      actor();
      const lines = ws.canvases().map((c) => {
        const doc = ws.doc(c);
        return `${c} (${doc.file}): ${doc.frames.map((f) => `"${f.frameName}" ${f.width}×${f.height ?? "hug"}`).join(", ") || "no frames"}`;
      });
      return text(lines.join("\n") || "No canvases. Use create_canvas.");
    },
  );

  server.registerTool(
    "get_canvas",
    {
      title: "Read canvas tree",
      description: "Outline of a canvas: frames and their JSX tree with node ids, props and text.",
      inputSchema: { ...canvasArg, frame: z.string().optional().describe("Only this frame (name or id)."), depth: z.number().int().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, frame, depth }) => {
      try {
        const c = resolveCanvas(canvas);
        presence(c, "reading", frame ? `Reading ${frame}` : "Reading the canvas", [], frame ?? null);
        return text(outlineDoc(ws.doc(c), { frame, depth }));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "get_node",
    {
      title: "Read node source",
      description: "Exact TSX source of a node, its props, and the component's prop types.",
      inputSchema: { ...canvasArg, id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, id }) => {
      try {
        const c = resolveCanvas(canvas);
        const source = ws.read(c);
        const doc = ws.doc(c);
        const hit = findNode(doc, id);
        if (!hit) return fail(new Error(`No node ${id}.`));
        presence(c, "reading", `Reading ${hit.node.name}`, [id]);
        await ws.catalog.load();
        const spec = hit.node.kind === "component" ? ws.catalog.get(hit.node.name) : undefined;
        return text(
          [`${hit.node.name} [${id}] in frame "${hit.frame.frameName}", ${doc.file}:${hit.node.line}`, "```tsx", source.slice(hit.node.start, hit.node.end), "```", spec ? describeComponent(spec, true) : ""].join("\n"),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_components",
    {
      title: "List components",
      description: "The project's React components with their props (from TypeScript types).",
      inputSchema: { query: z.string().optional().describe("Filter by name or file.") },
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => {
      actor();
      const q = query?.toLowerCase();
      const list = (await ws.catalog.load()).filter((c) => !q || c.name.toLowerCase().includes(q) || c.file.toLowerCase().includes(q));
      return text(list.map((c) => describeComponent(c)).join("\n") || "No components found.");
    },
  );

  server.registerTool(
    "get_component",
    {
      title: "Component details",
      description: "Full prop types, defaults and docs of one component.",
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => {
      actor();
      await ws.catalog.load();
      const spec = ws.catalog.get(name);
      return spec ? text(describeComponent(spec, true)) : fail(new Error(`Unknown component ${name}.`));
    },
  );

  server.registerTool(
    "get_design_tokens",
    {
      title: "Design tokens",
      description: "The project's Tailwind theme tokens (colors, fonts, radius, shadows) to use in className.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      actor();
      return text(readDesignTokens(ws.config.root));
    },
  );

  server.registerTool(
    "get_selection",
    {
      title: "Get user selection",
      description: "What the user currently has selected in the Truecanvas editor, with the source of each node.",
      annotations: { readOnlyHint: true },
    },
    async () => {
      actor();
      const { canvas, ids } = ws.selection;
      if (!canvas) return text("The editor is not open.");
      if (!ids.length) return text(`Nothing selected. Open canvas: ${canvas}.`);
      lastCanvas = canvas;
      presence(canvas, "looking", "Looking at your selection", ids);
      const doc = ws.doc(canvas);
      const source = ws.read(canvas);
      const parts = [`canvas: ${canvas}`];
      for (const id of ids) {
        const hit = findNode(doc, id);
        if (!hit) continue;
        parts.push(`[${id}] ${hit.node.name} in frame "${hit.frame.frameName}"\n\`\`\`tsx\n${source.slice(hit.node.start, hit.node.end)}\n\`\`\``);
      }
      return text(parts.join("\n\n"));
    },
  );

  server.registerTool(
    "set_props",
    {
      title: "Set props",
      description: "Set literal props on a node. null removes the prop (falls back to its default).",
      inputSchema: { ...canvasArg, id: z.string(), props: z.record(z.string(), literal) },
      annotations: { idempotentHint: true },
    },
    ({ canvas, id, props }) => edit(() => ({ op: "set_props", canvas: resolveCanvas(canvas), id, props })),
  );

  server.registerTool(
    "set_text",
    {
      title: "Set text",
      description: "Replace the text content of a node (or of a text node).",
      inputSchema: { ...canvasArg, id: z.string(), text: z.string() },
      annotations: { idempotentHint: true },
    },
    ({ canvas, id, text: t }) => edit(() => ({ op: "set_text", canvas: resolveCanvas(canvas), id, text: t })),
  );

  server.registerTool(
    "set_class_name",
    {
      title: "Set Tailwind classes",
      description: "Replace a node's className (Tailwind). Use for layout: flex, gap-*, p-*, items-*, justify-*.",
      inputSchema: { ...canvasArg, id: z.string(), className: z.string() },
      annotations: { idempotentHint: true },
    },
    ({ canvas, id, className }) => edit(() => ({ op: "set_class", canvas: resolveCanvas(canvas), id, className })),
  );

  server.registerTool(
    "insert_jsx",
    {
      title: "Insert JSX",
      description: "Insert a JSX snippet as a child of a frame or node. Catalog components are imported automatically.",
      inputSchema: {
        ...canvasArg,
        parent: z.string().describe("Frame name/id or node id."),
        index: z.number().int().optional().describe("Child index; omit to append."),
        jsx: z.string(),
      },
    },
    ({ canvas, parent, index, jsx }) => edit(() => ({ op: "insert_jsx", canvas: resolveCanvas(canvas), parent, index, jsx })),
  );

  server.registerTool(
    "replace_node",
    {
      title: "Replace node",
      description: "Replace a node (and its children) with a JSX snippet.",
      inputSchema: { ...canvasArg, id: z.string(), jsx: z.string() },
    },
    ({ canvas, id, jsx }) => edit(() => ({ op: "replace", canvas: resolveCanvas(canvas), id, jsx })),
  );

  server.registerTool(
    "duplicate_nodes",
    {
      title: "Duplicate",
      description: "Duplicate nodes or frames in place (frames are placed to the right).",
      inputSchema: { ...canvasArg, ids: z.array(z.string()).min(1) },
    },
    ({ canvas, ids }) => edit(() => ({ op: "duplicate", canvas: resolveCanvas(canvas), ids })),
  );

  server.registerTool(
    "delete_nodes",
    {
      title: "Delete",
      description: "Delete nodes or frames.",
      inputSchema: { ...canvasArg, ids: z.array(z.string()).min(1) },
      annotations: { destructiveHint: true },
    },
    ({ canvas, ids }) => edit(() => ({ op: "delete", canvas: resolveCanvas(canvas), ids })),
  );

  server.registerTool(
    "move_node",
    {
      title: "Move node",
      description: "Move a node to another parent (frame or node) at an index.",
      inputSchema: { ...canvasArg, id: z.string(), parent: z.string(), index: z.number().int().optional() },
    },
    ({ canvas, id, parent, index }) => edit(() => ({ op: "move", canvas: resolveCanvas(canvas), id, parent, index })),
  );

  server.registerTool(
    "wrap_nodes",
    {
      title: "Wrap in auto layout",
      description: "Wrap sibling nodes in a <div> with Tailwind layout classes (default: flex flex-col gap-2).",
      inputSchema: { ...canvasArg, ids: z.array(z.string()).min(1), className: z.string().optional() },
    },
    ({ canvas, ids, className }) => edit(() => ({ op: "wrap", canvas: resolveCanvas(canvas), ids, className })),
  );

  server.registerTool(
    "create_frame",
    {
      title: "Create frame",
      description: "Add a frame (artboard). Placed right of existing frames unless x/y are given. Omit height to hug content.",
      inputSchema: {
        ...canvasArg,
        name: z.string(),
        width: z.number().optional().describe("Default 1024."),
        height: z.number().nullable().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        theme: z.enum(["light", "dark"]).nullable().optional(),
        device: z.enum(deviceIds).optional().describe(`Device preset; sets width/height. ${DEVICES.map((d) => `${d.id} ${d.width}×${d.height}`).join(", ")}`),
        jsx: z.string().optional().describe("Initial content."),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "create_frame", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "update_frame",
    {
      title: "Update frame",
      description: "Rename, move, resize or theme a frame. height: null = hug content; theme: null = inherit.",
      inputSchema: {
        ...canvasArg,
        frame: z.string().describe("Frame name or id."),
        name: z.string().optional(),
        x: z.number().optional(),
        y: z.number().optional(),
        width: z.number().optional(),
        height: z.number().nullable().optional(),
        theme: z.enum(["light", "dark"]).nullable().optional(),
        device: z.enum(deviceIds).nullable().optional().describe("Device preset (sets size); null removes it."),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "update_frame", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "create_variants_frame",
    {
      title: "Variants frame",
      description: "New frame showing a component once per value of a union/boolean prop. Great for reviewing states.",
      inputSchema: { ...canvasArg, component: z.string(), prop: z.string(), props: z.record(z.string(), literal).optional() },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "create_variants", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "import_page",
    {
      title: "Link an app page",
      description:
        "Add a frame showing one of the app's real pages, with its layouts. By default the frame is LINKED: its layers are the page's own JSX and editing them edits the page and layout files directly (git tracks it). Pages with data or logic are view only when linked. Pass copy=true for a detached copy in the canvas file instead.",
      inputSchema: {
        ...canvasArg,
        route: z.string().describe('URL path like "/" or "/pricing", or the page file'),
        name: z.string().optional(),
        width: z.number().optional().describe("Default 1440."),
        copy: z.boolean().optional().describe("Copy the page's JSX into the canvas instead of linking. Default false."),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "import_route", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "explore_copy",
    {
      title: "Explore a copy of a page",
      description:
        "Copy a linked frame into a new exploration frame next to it. The copy lives in the canvas file, so you can try bold changes without touching the real page. When it's good, apply_to_page writes it back.",
      inputSchema: { ...canvasArg, frame: z.string().describe("Name or id of a linked frame."), name: z.string().optional() },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "explore_copy", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "apply_to_page",
    {
      title: "Apply exploration to page",
      description:
        "Write an exploration frame (made with explore_copy) back to its page file: the page's returned JSX is replaced with the frame's content, needed imports are added and unused ones removed. The page's layouts are not changed. Undoable.",
      inputSchema: { ...canvasArg, frame: z.string().describe("Name or id of the exploration frame.") },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "apply_to_page", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "create_component",
    {
      title: "Create a component",
      description:
        "Create a new component file in the project's components folder. With `from` (a node id), the selected layers move into it and are replaced by <Name />, imports included. Without it, a starter component is created and, with `parent`, inserted there. Then use open_component to design it.",
      inputSchema: {
        ...canvasArg,
        name: z.string().describe('PascalCase, e.g. "PricingCard"'),
        from: z.string().optional().describe("Node id to turn into the component."),
        parent: z.string().optional(),
        index: z.number().optional(),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "create_component", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "open_component",
    {
      title: "Open a main component",
      description:
        "Add a main component frame for a project component (Figma's main component): its layers are the component's own JSX, edits go to its file, and every instance in the app follows. Expressions inside it (props, {children}) are read-only; className={cn(\"…\", className)} edits the static classes. Reuses the frame if it's already open.",
      inputSchema: { ...canvasArg, component: z.string().describe("Component name from list_components.") },
    },
    ({ canvas, component }) => edit(() => ({ op: "add_component_frame", canvas: resolveCanvas(canvas), component })),
  );

  server.registerTool(
    "add_animation",
    {
      title: "Animate a layer",
      description:
        'Make a layer animate in when it scrolls into view. kind "reveal" wraps the layer in <Reveal> (effects: fade-up, fade-down, fade-in, blur-in, scale-in, slide-left, slide-right). kind "text" wraps the layer\'s text in <TextAnimate> (effects: words, letters, blur-in, slide-up, typewriter), keeping inline elements like <em>. The first use adds both components to the project (components/motion/), plain React, no dependencies. Calling it again on an animated layer updates its settings. For a staggered list, give each item a growing delay.',
      inputSchema: {
        ...canvasArg,
        id: z.string().describe("Layer to animate (or its existing Reveal/TextAnimate)."),
        kind: z.enum(["reveal", "text"]),
        effect: z.string().optional(),
        delay: z.number().min(0).max(5).optional().describe("Seconds before it starts."),
        duration: z.number().min(0.05).max(5).optional().describe("Seconds."),
        stagger: z.number().min(0).max(1).optional().describe("Text only: seconds between words or letters."),
        once: z.boolean().optional().describe("Only the first time it enters the view. Default true."),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "add_animation", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "remove_animation",
    {
      title: "Remove an animation",
      description: "Unwrap a layer's <Reveal> or <TextAnimate>, leaving the layer as it was. The import goes when no longer used.",
      inputSchema: { ...canvasArg, id: z.string(), kind: z.enum(["reveal", "text"]) },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "remove_animation", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "play_frame",
    {
      title: "Play a frame",
      description:
        'Show animations in the user\'s editor. "play": the frame becomes one screen tall and scrolls inside, so scroll reveals run like on the site. "replay": rerun the entrance animations. "stop": back to the full-height view. (screenshot_frame always captures animations finished.)',
      inputSchema: { ...canvasArg, frame: z.string(), mode: z.enum(["play", "replay", "stop"]).default("replay") },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, frame, mode }) => {
      const c = resolveCanvas(canvas);
      let f;
      try {
        f = ws.findFrameOf(c, frame);
      } catch (e) {
        return fail(e);
      }
      presence(c, "looking", mode === "play" ? "Playing" : mode === "stop" ? "Stopped" : "Replaying", [f.id]);
      ws.emit({ type: "motion", canvas: c, frame: f.frameName, action: mode });
      return text(`✓ ${mode === "play" ? "Playing" : mode === "stop" ? "Stopped" : "Replayed"} ${f.frameName} in the editor.`);
    },
  );

  server.registerTool(
    "add_background",
    {
      title: "Add background",
      description: "Put a component (typically a shader like MeshGradient or GrainGradient) behind a frame or layer, filling it. Optionally with a named preset.",
      inputSchema: {
        ...canvasArg,
        parent: z.string().describe("Frame name/id or node id."),
        component: z.string().describe("Component name, e.g. MeshGradient."),
        preset: z.string().optional().describe("Preset name from get_component."),
      },
    },
    ({ canvas, ...rest }) => edit(() => ({ op: "add_background", canvas: resolveCanvas(canvas), ...rest })),
  );

  server.registerTool(
    "apply_preset",
    {
      title: "Apply preset",
      description: "Apply one of a component's named presets (see get_component) to a node.",
      inputSchema: { ...canvasArg, id: z.string(), preset: z.string() },
    },
    ({ canvas, id, preset }) => edit(() => ({ op: "apply_preset", canvas: resolveCanvas(canvas), id, preset })),
  );

  server.registerTool(
    "create_canvas",
    {
      title: "Create canvas",
      description: "Create a new canvas file with a starter frame.",
      inputSchema: { name: z.string().describe("kebab-case, e.g. onboarding") },
    },
    async ({ name }) => {
      try {
        ws.createCanvas(name, actor());
        return text(`✓ Created canvas ${name} (${ws.relFile(name)}). The app picks it up in a second.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_comments",
    {
      title: "Read comments",
      description: "Comments people left on the canvas (pinned to frames/layers), with the source of the commented layer. Address them, then resolve_comment.",
      inputSchema: { ...canvasArg, include_resolved: z.boolean().optional() },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, include_resolved }) => {
      try {
        const c = resolveCanvas(canvas);
        const threads = ws.comments.list(c).filter((t) => include_resolved || !t.resolved);
        presence(c, "reading", `Reading ${threads.length} comment${threads.length === 1 ? "" : "s"}`);
        if (!threads.length) return text(include_resolved ? "No comments on this canvas." : "No open comments. (include_resolved: true shows resolved ones.)");
        const doc = ws.doc(c);
        const source = ws.read(c);
        const parts = threads.map((t) => {
          // find the commented layer in the current tree by path + name
          let where = "";
          if (t.node) {
            const node = findByPath(doc, t.node.path.split(".").map(Number));
            if (node && node.name === t.node.name) where = `\non [${node.id}] ${node.name}:\n\`\`\`tsx\n${source.slice(node.start, node.end)}\n\`\`\``;
            else where = `\non a ${t.node.name} (it may have moved)`;
          }
          const msgs = t.messages.map((m) => `  ${m.author.name}${m.author.kind === "agent" ? " (agent)" : m.author.kind === "client" ? " (client)" : ""}: ${m.text}`).join("\n");
          const shared = t.share ? " [from a client on the share link: replies and resolving are sent to the client]" : "";
          return `thread ${t.id}${t.resolved ? " [resolved]" : ""}${shared} in frame "${t.frame}" at ${t.x},${t.y}${where}\n${msgs}`;
        });
        return text(parts.join("\n\n"));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "reply_comment",
    {
      title: "Reply to a comment",
      description: "Reply in a comment thread, e.g. to explain a change or ask a question.",
      inputSchema: { ...canvasArg, thread: z.string(), text: z.string() },
    },
    async ({ canvas, thread, text: body }) => {
      try {
        const c = resolveCanvas(canvas);
        const a = actor();
        const t = ws.comments.reply(c, thread, body, { name: a.kind === "agent" ? a.name : "agent", kind: "agent" });
        ws.commentsChanged(c);
        presence(c, "editing", "Replied to a comment", [], t.frame);
        return text(`✓ Replied in thread ${t.id}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve a comment",
      description: "Mark a comment thread as resolved once you've addressed it, optionally with a short note of what you changed.",
      inputSchema: { ...canvasArg, thread: z.string(), note: z.string().optional() },
    },
    async ({ canvas, thread, note }) => {
      try {
        const c = resolveCanvas(canvas);
        const a = actor();
        const author = { name: a.kind === "agent" ? a.name : "agent", kind: "agent" as const };
        if (note?.trim()) ws.comments.reply(c, thread, note, author);
        const t = ws.comments.resolve(c, thread, true, author);
        ws.commentsChanged(c);
        presence(c, "editing", "Resolved a comment", [], t.frame);
        return text(`✓ Resolved thread ${t.id}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "rename_canvas",
    {
      title: "Rename canvas",
      description: "Rename a canvas (page). Renames its .canvas.tsx file.",
      inputSchema: { canvas: z.string(), name: z.string().describe("kebab-case") },
    },
    async ({ canvas, name }) => {
      try {
        actor();
        ws.renameCanvas(canvas, name);
        if (lastCanvas === canvas) lastCanvas = name;
        return text(`✓ Renamed ${canvas} to ${name}.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "delete_canvas",
    {
      title: "Delete canvas",
      description: "Delete a canvas (page) file. Ask the user first.",
      inputSchema: { canvas: z.string() },
      annotations: { destructiveHint: true },
    },
    async ({ canvas }) => {
      try {
        actor();
        ws.deleteCanvas(canvas);
        if (lastCanvas === canvas) lastCanvas = null;
        return text(`✓ Deleted ${canvas}. The user can restore it from the editor during this session.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "share_canvas",
    {
      title: "Share canvas",
      description:
        "Share a canvas with a client as a link: every frame is rendered by the app and frozen into static HTML (no scripts, no API calls), then published to the studio's review site as a new version of the canvas's link. Without a review site set up, returns a local preview instead. Data the app showed while rendering is in the snapshot: use sample data, never real client data.",
      inputSchema: {
        ...canvasArg,
        frames: z.array(z.string()).optional().describe("Frame names to share; omit for all."),
        title: z.string().optional().describe("Title the client sees, e.g. \"Homepage, round 2\"."),
        live: z
          .string()
          .optional()
          .describe("Another real site to use: the https URL where the app runs, or a static build folder (Next `out/`, Vite `dist/`, relative to the project). Usually omitted: the app is built as static pages automatically."),
        frozen: z.boolean().optional().describe("Leave the real site out (frozen frames only). By default the app is built as static pages so clients scroll and click the actual pages."),
        invite: z
          .array(z.string())
          .optional()
          .describe("Emails of people to invite (the client). Each gets an email with a link that signs them in and opens the design. Only invite addresses the user gave you."),
        access: z
          .enum(["invited", "password", "public"])
          .optional()
          .describe("Who can open the link: invited people (the default for new links on review sites with sign-in), a password (the user gives it to you), or anyone with the link. Existing links keep theirs unless this is set."),
        password: z.string().optional().describe("The link's password, with access \"password\"."),
      },
    },
    async ({ canvas, frames, title, live, frozen, invite, access, password }) => {
      try {
        const c = resolveCanvas(canvas);
        presence(c, "looking", "Preparing a share link");
        const { dir, manifest } = await createSnapshot(ws, shots, c, { frames });
        const preview = `http://localhost:${ws.config.port}/share/${encodeURIComponent(c)}/${manifest.id}/`;
        const notes = [
          manifest.external.length ? `While rendering, the app called ${manifest.external.join(", ")}: whatever it showed is in the snapshot.` : "",
          manifest.missing.length ? `${manifest.missing.length} asset(s) couldn't be fetched.` : "",
        ].filter(Boolean);
        const site = reviewSite();
        if (!site) return text([`✓ Snapshot ready (${manifest.frames.length} frames). No review site is set up, so this is a local preview: ${preview}`, "To get client links, the user runs `npx truecanvas share setup`.", ...notes].join("\n"));
        let liveSite: LiveSite | undefined = live ? (/^https?:\/\//.test(live) ? { url: live } : { dir: path.resolve(ws.config.root, live) }) : undefined;
        // the real site: the app built as static pages, when the review site hosts them
        let built: Awaited<ReturnType<typeof exportSite>> | null = null;
        if (!liveSite && !frozen && canExport(ws.config) && (await siteFeatures(site).catch((): string[] => [])).includes("live-files")) {
          presence(c, "looking", "Building the real site");
          try {
            built = await exportSite(ws.config);
            liveSite = { dir: built.dir };
          } catch (err) {
            notes.push(`The real site couldn't be built, so this version has frozen frames only: ${(err as Error).message}`);
          }
        }
        const published = await publishSnapshot(site, dir, manifest, { title, live: liveSite, access, password, invite: invite?.length ? parseEmails(invite) : undefined }).finally(() => built?.cleanup());
        const who =
          published.access === "invited" ? ", invited people only" : published.access === "public" ? ", anyone with the link" : published.password ? ", password protected" : "";
        return text(
          [
            `✓ Shared ${manifest.frames.length} frame(s): ${published.url}`,
            `Version ${published.versions} of this link${who}.`,
            published.live ? "The real site is included: clients scroll and click the actual pages." : "",
            ...published.invited.map((i) => (i.error ? `Couldn't email ${i.email}: ${i.error}` : `Invited ${i.email} (emailed a sign-in link).`)),
            published.access === "invited" && !published.invited.length ? "Only invited people and the studio can open it: share again with `invite` to invite the client." : "",
            ...notes,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "make_shot",
    {
      title: "Make a shot",
      description:
        "Stage a frame for social posts (X, LinkedIn): the frame as the app renders it, on a backdrop (a Paper shader, a gradient or a color), with framing (margin, corners, shadow, tilt, browser or phone chrome) at a social format, exported as a PNG in the project's shots/ folder. Settings are saved in <page>.shots.json, so the user can open the shot in the editor's Shot dialog and tweak it, and it can be exported again after design changes. Changes apply on top of the frame's latest shot (or the one given by id); pass new: true for another shot of the same frame. Returns a small preview to check the result.",
      inputSchema: {
        ...canvasArg,
        frame: z.string().describe("The frame's name."),
        id: z.string().optional().describe("A saved shot to change (list_shots shows them)."),
        new: z.boolean().optional().describe("Start a new shot of this frame instead of changing its latest one."),
        format: z.enum(Object.keys(SHOT_FORMATS) as [string, ...string[]]).optional().describe("4:5 (LinkedIn and X feed, the default), 1:1, 16:9 (X, slides), 9:16 (stories), 3:2."),
        backdrop: z
          .object({
            type: z.enum(["shader", "gradient", "solid"]).optional(),
            shader: z.enum(SHOT_SHADERS).optional().describe("MeshGradient (soft blobs), GrainGradient (grainy), StaticMeshGradient (silky), StaticRadialGradient (a glow), Warp (bold swirls)."),
            colors: z.array(z.string()).optional().describe("2 to 5 CSS colors, the first is the base. The brand's colors flatter its design; dark ones make a light design stand out."),
            angle: z.number().optional().describe("Gradient angle in degrees."),
            grain: z.number().optional().describe("Film grain, 0 to 1 (0.25 is subtle)."),
            shuffle: z.boolean().optional().describe("Another variation of the shader."),
          })
          .optional(),
        framing: z
          .object({
            padding: z.number().optional().describe("Margin around the design, 0 to 0.3 of the format's shorter side."),
            radius: z.number().optional(),
            shadow: z.enum(["none", "soft", "strong"]).optional(),
            tilt: z.number().optional().describe("3D tilt, -20 to 20 degrees."),
            chrome: z.enum(["none", "browser", "phone"]).optional(),
            position: z.enum(["center", "bleed"]).optional().describe("bleed: the design rises from the bottom edge and is cut off by it."),
          })
          .optional(),
        crop: z.object({ mode: z.enum(["top", "full"]).optional(), height: z.number().optional().describe("With top: how many px of the frame, from its top.") }).optional(),
      },
    },
    async ({ canvas, frame, id, new: fresh, format, backdrop, framing, crop }) => {
      try {
        if (!shotService) throw new Error("Shots are made by the Truecanvas server (npx truecanvas).");
        const c = resolveCanvas(canvas);
        if (!ws.doc(c).frames.some((f) => f.frameName === frame)) throw new Error(`No frame named "${frame}" in ${c}.`);
        presence(c, "looking", `Making a shot of ${frame}`);
        const saved = ws.shots.list(c);
        const brand = readTokenData(ws.config.root).colors.map((x) => x.light);
        const base: Shot = (!fresh && (id ? saved.find((s) => s.id === id) : saved.find((s) => s.frame === frame))) || newShot(frame, brand.filter((x) => /^#[0-9a-f]{6}$/i.test(x)).slice(0, 4));
        const { shuffle, ...back } = backdrop ?? {};
        const shot = ws.shots.save(
          c,
          normalizeShot({
            ...base,
            frame,
            ...(format ? { format } : {}),
            backdrop: { ...base.backdrop, ...back, ...(shuffle ? { seed: Math.floor(Math.random() * 100_000) } : {}) },
            framing: { ...base.framing, ...framing },
            crop: { ...base.crop, ...crop },
          }),
        );
        const out = await shotService.export(c, shot);
        const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        const rel = path.join("shots", `${slug(c)}-${slug(frame)}-${shot.format.replace(":", "x")}.png`);
        fs.mkdirSync(path.join(ws.config.root, "shots"), { recursive: true });
        fs.writeFileSync(path.join(ws.config.root, rel), out.png);
        const preview = await shotService.preview(c, shot);
        return {
          content: [
            { type: "image" as const, data: preview.toString("base64"), mimeType: "image/png" },
            {
              type: "text" as const,
              text: `✓ Shot ${shot.id} of "${frame}" (${shot.format}, ${shot.backdrop.type}${shot.backdrop.type === "shader" ? ` ${shot.backdrop.shader}` : ""}): ${rel}, ${out.width}×${out.height}. Saved in ${c}.shots.json: the user can open it from the frame's Make a shot in the editor.`,
            },
          ],
        };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "list_shots",
    {
      title: "List shots",
      description: "The saved shots of a canvas (made in the editor's Shot dialog or with make_shot): frame, format, backdrop, framing.",
      inputSchema: { ...canvasArg },
    },
    async ({ canvas }) => {
      try {
        const c = resolveCanvas(canvas);
        const list = ws.shots.list(c);
        return text(list.length ? JSON.stringify(list, null, 2) : `${c} has no shots yet. make_shot creates one.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "start_session",
    {
      title: "Start a live session",
      description:
        "Start a live session on a canvas's share link: while it runs, people with access to the link see the real frames from the app (not the frozen snapshot), they update as the canvas is edited, everyone sees each other's cursors, and comments arrive instantly. The canvas must have been shared once (share_canvas). It runs until stop_session or until Truecanvas stops. Only start one when the user asks.",
      inputSchema: { ...canvasArg },
    },
    async ({ canvas }) => {
      try {
        if (!sessions) throw new Error("Live sessions run from the Truecanvas server (npx truecanvas).");
        const c = resolveCanvas(canvas);
        const s = await sessions.start(c);
        return text(`✓ Live session started on ${c}: ${s.url}\nPeople with access to the link now see the frames live. Stop it with stop_session.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "stop_session",
    {
      title: "Stop a live session",
      description: "Stop a canvas's live session: the link goes back to its latest published version.",
      inputSchema: { ...canvasArg },
    },
    async ({ canvas }) => {
      try {
        if (!sessions) throw new Error("Live sessions run from the Truecanvas server (npx truecanvas).");
        const c = resolveCanvas(canvas);
        return text(sessions.stop(c) ? `✓ Stopped the live session on ${c}.` : `${c} has no live session.`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "screenshot_frame",
    {
      title: "Screenshot frame",
      description: "PNG of a frame rendered by the real app. Use it to check your work.",
      inputSchema: {
        ...canvasArg,
        frame: z.string().describe("Frame name or id."),
        theme: z.enum(["light", "dark"]).optional().describe("Override for frames that inherit."),
        scale: z.number().min(0.5).max(2).optional().describe("Device pixel ratio, default 1."),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, frame, theme, scale }) => {
      try {
        const c = resolveCanvas(canvas);
        const f = ws.findFrameOf(c, frame);
        presence(c, "looking", "Taking a screenshot", [], f.frameName);
        const device = findDevice(f.device);
        const png = await shots.frame({ canvas: c, frame: f.frameName, width: f.width, height: f.height, theme: f.theme ?? theme ?? "light", scale, mobile: device ? device.kind !== "desktop" : false });
        return { content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }, { type: "text" as const, text: `Frame "${f.frameName}" ${f.width}×${f.height ?? "hug"}` }] };
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "focus",
    {
      title: "Show in editor",
      description: "Select and zoom to nodes or frames in the user's editor, to show them what you did.",
      inputSchema: { ...canvasArg, ids: z.array(z.string()).min(1) },
      annotations: { readOnlyHint: true },
    },
    async ({ canvas, ids }) => {
      const a = actor();
      const c = resolveCanvas(canvas);
      presence(c, "looking", "Look here", ids);
      ws.emit({ type: "focus", canvas: c, ids, actor: a.kind === "agent" ? a.name : "agent" });
      return text("✓ Shown in the editor.");
    },
  );

  server.registerTool(
    "undo",
    { title: "Undo", description: "Undo the last change on a canvas (yours or the user's).", inputSchema: { ...canvasArg } },
    async ({ canvas }) => {
      try {
        return text(`✓ ${(await ws.undo(resolveCanvas(canvas), actor())).label}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "redo",
    { title: "Redo", description: "Redo the last undone change.", inputSchema: { ...canvasArg } },
    async ({ canvas }) => {
      try {
        return text(`✓ ${(await ws.redo(resolveCanvas(canvas), actor())).label}`);
      } catch (e) {
        return fail(e);
      }
    },
  );

  // ---------- libraries: icon sets and shadcn/ui ----------
  const root = ws.config.root;
  const installedIcons = () => iconLibraries(root).filter((l) => l.version);

  server.registerTool(
    "list_libraries",
    {
      title: "List libraries",
      description: "Icon libraries (installed or available) and shadcn/ui status for this project.",
      annotations: { readOnlyHint: true },
    },
    () => {
      const st = libraryState(root);
      const icons = st.icons.map((l) => `  ${l.id.padEnd(16)} ${l.version ? `installed ${l.version}` : "not installed"}  (${l.package}${l.from !== l.package ? `, imports from ${l.from}` : ""})`);
      const shadcn = st.shadcn.initialized ? `set up, components in ${st.shadcn.uiDir}: ${st.shadcn.installed.join(", ") || "none yet"}` : "not set up (add_shadcn_components sets it up)";
      return text(`Package manager: ${st.packageManager}\nIcon libraries:\n${icons.join("\n")}\nshadcn/ui: ${shadcn}`);
    },
  );

  server.registerTool(
    "install_library",
    {
      title: "Install icon library",
      description: "Install an icon library into the project with its package manager (adds a dependency).",
      inputSchema: { library: z.enum(ICON_LIBRARIES.map((l) => l.id) as [string, ...string[]]) },
    },
    async ({ library }) => {
      try {
        const out = await installIconLibrary(root, library);
        if (!out.ok) return fail(new Error(`Installing ${out.package} failed:\n${out.out.slice(-1500)}`));
        return text(`✓ Installed ${out.package}. Use search_icons to find icons.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "search_icons",
    {
      title: "Search icons",
      description: "Find icon names in an installed icon library. Without a query, lists the first icons.",
      inputSchema: {
        query: z.string().optional(),
        library: z.string().optional().describe("Library id (lucide, tabler…). Defaults to the first installed one."),
        limit: z.number().int().min(1).max(500).optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ query, library, limit }) => {
      try {
        const lib = library ?? installedIcons()[0]?.id;
        if (!lib) return fail(new Error("No icon library is installed. Use install_library (lucide is a good default)."));
        const res = searchIcons(await loadIcons(root, lib), query ?? "", limit ?? 60);
        if (!res.icons.length) return text(`No icons match "${query}" in ${lib}.`);
        return text(`${res.total} match${res.total === 1 ? "" : "es"} in ${lib}${res.total > res.icons.length ? ` (first ${res.icons.length})` : ""}:\n${res.icons.map((i) => i.name).join(", ")}`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  server.registerTool(
    "insert_icon",
    {
      title: "Insert icon",
      description: "Insert an icon from an installed library as a child of a frame or node, with its import. className defaults to size-4.",
      inputSchema: {
        ...canvasArg,
        parent: z.string(),
        name: z.string().describe("Icon name from search_icons, e.g. Search"),
        library: z.string().optional().describe("Library id. Defaults to the first installed one."),
        index: z.number().int().optional(),
        className: z.string().optional(),
      },
    },
    ({ canvas, parent, name, library, index, className }) =>
      edit(() => {
        const lib = library ?? installedIcons()[0]?.id;
        if (!lib) throw new Error("No icon library is installed. Use install_library first.");
        return { op: "insert_icon", canvas: resolveCanvas(canvas), parent, name, library: lib, index, className };
      }),
  );

  server.registerTool(
    "add_shadcn_components",
    {
      title: "Add shadcn/ui components",
      description: "Copy shadcn/ui components into the project with the shadcn CLI (sets shadcn up first if needed). They then show up in list_components.",
      inputSchema: { names: z.array(z.string()).min(1).describe('Registry names, e.g. ["button", "card", "dialog"]') },
    },
    async ({ names }) => {
      try {
        const out = await addShadcnComponents(root, names);
        if (!out.ok) return fail(new Error(`shadcn failed:\n${out.out.slice(-1500)}`));
        ws.catalog.invalidate();
        const already = names.filter((n) => !out.added.includes(n));
        return text(`✓ ${out.added.length ? `Added ${out.added.join(", ")}` : "Nothing new to add"}${already.length ? ` (already there: ${already.join(", ")})` : ""}. Use list_components to see their props.`);
      } catch (err) {
        return fail(err);
      }
    },
  );

  return server;
}
