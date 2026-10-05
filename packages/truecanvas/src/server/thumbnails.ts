import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Workspace } from "../core/workspace.js";
import type { ComponentSpec } from "../core/types.js";
import type { Screenshotter } from "./screenshot.js";

/**
 * Assets thumbnails: each component rendered once by the real app at
 * /truecanvas/__preview, screenshotted, and cached on disk until its file changes.
 * Renders run one at a time to stay light on memory.
 */
export class Thumbnails {
  private queue: Promise<unknown> = Promise.resolve();
  private dir: string;

  constructor(
    private ws: Workspace,
    private shots: Screenshotter,
  ) {
    this.dir = path.join(ws.config.root, "node_modules", ".cache", "truecanvas", "thumbs");
  }

  /** Props a component gets in its thumbnail: defaults, required placeholders, a label, or a preset. */
  static previewProps(spec: ComponentSpec, preset?: string): Record<string, unknown> {
    const props: Record<string, unknown> = {};
    for (const p of spec.props) {
      if (p.optional || p.default !== undefined || p.name === "children") continue;
      if (p.type === "string") props[p.name] = p.name === "title" || p.name === "label" ? spec.name : p.name;
      else if (p.type === "enum") props[p.name] = p.options![0];
      else if (p.type === "boolean") props[p.name] = false;
      else if (p.type === "number") props[p.name] = 0;
    }
    const children = spec.props.find((p) => p.name === "children");
    if (spec.acceptsChildren && children && children.default === undefined) props.children = spec.name;
    if (spec.library && !spec.acceptsChildren) Object.assign(props, { width: 320, height: 200 });
    const p = preset ? spec.presets?.find((x) => x.name === preset) : undefined;
    if (p) Object.assign(props, p.props);
    return props;
  }

  private key(spec: ComponentSpec, props: Record<string, unknown>) {
    let stamp = "";
    try {
      const file = spec.library ? path.join(this.ws.config.root, "node_modules", spec.library, "package.json") : path.join(this.ws.config.root, spec.file);
      stamp = String(fs.statSync(file).mtimeMs);
    } catch {
      stamp = "0";
    }
    return crypto.createHash("sha1").update(JSON.stringify({ v: 1, name: spec.name, props, stamp })).digest("hex").slice(0, 16);
  }

  async get(name: string, preset?: string): Promise<Buffer> {
    await this.ws.catalog.load();
    const spec = this.ws.catalog.get(name);
    if (!spec) throw new Error(`Unknown component ${name}`);
    const props = Thumbnails.previewProps(spec, preset);
    const file = path.join(this.dir, `${name}-${this.key(spec, props)}.png`);
    if (fs.existsSync(file)) return fs.readFileSync(file);
    const job = this.queue.then(async () => {
      if (fs.existsSync(file)) return fs.readFileSync(file);
      const url = `${this.ws.config.appUrl}/truecanvas/__preview?component=${encodeURIComponent(name)}&props=${encodeURIComponent(JSON.stringify(props))}`;
      const png = await this.shots.element(url, { width: 640, height: 480 });
      fs.mkdirSync(this.dir, { recursive: true });
      fs.writeFileSync(file, png);
      return png;
    });
    this.queue = job.catch(() => undefined);
    return job;
  }
}
