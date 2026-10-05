import type { CanvasDoc, CanvasFrame, CanvasNode, ComponentSpec, PropValue } from "./types.js";

function propText(name: string, v: PropValue): string {
  if (v.kind === "boolean") return v.value ? name : `${name}={false}`;
  if (v.kind === "string") return `${name}=${JSON.stringify(v.value.length > 60 ? `${v.value.slice(0, 57)}…` : v.value)}`;
  if (v.kind === "number") return `${name}={${v.value}}`;
  if (v.kind === "array") return `${name}={[${v.value.map((x) => JSON.stringify(x)).join(", ")}]}`;
  return `${name}={${v.code.length > 40 ? `${v.code.slice(0, 37)}…` : v.code}}`;
}

function linkText(f: CanvasFrame): string {
  if (f.link?.kind === "component") {
    return f.link.editable ? ` MAIN COMPONENT ${f.link.route} (${f.link.page}): layer edits write to that file, every instance follows` : ` MAIN COMPONENT, unavailable: ${f.link.reason ?? ""}`;
  }
  if (f.link) {
    if (!f.link.editable) return ` LINKED to ${f.link.page}, view only: ${f.link.reason ?? ""}`;
    return ` LINKED to ${f.link.page} (route ${f.link.route}): layer edits write to ${f.link.files.join(" and ")}`;
  }
  if (f.from) return ` exploration of ${f.from} (apply_to_page writes it back)`;
  return "";
}

/** Compact, token-cheap tree an agent can read: one line per node, ids in brackets. */
export function outlineDoc(doc: CanvasDoc, opts: { frame?: string; depth?: number } = {}): string {
  const lines: string[] = [`canvas "${doc.name}" (${doc.file})`];
  if (doc.error) lines.push(`⚠ parse error: ${doc.error}`);
  const frames = opts.frame ? doc.frames.filter((f) => f.frameName === opts.frame || f.id === opts.frame) : doc.frames;
  for (const f of frames) {
    lines.push(
      `frame "${f.frameName}" [${f.id}] x=${f.x} y=${f.y} w=${f.width} h=${f.height ?? "hug"} theme=${f.theme ?? "inherit"}${linkText(f)}`,
    );
    for (const c of f.children) outlineNode(c, 1, lines, opts.depth ?? 99);
  }
  if (!frames.length) lines.push("(no frames)");
  return lines.join("\n");
}

function outlineNode(n: CanvasNode, depth: number, lines: string[], max: number) {
  const pad = "  ".repeat(depth);
  if (n.kind === "text") {
    lines.push(`${pad}"${n.text}" [${n.id}]`);
    return;
  }
  if (n.kind === "expression") {
    lines.push(`${pad}{${n.name.length > 60 ? `${n.name.slice(0, 57)}…` : n.name}} [${n.id}] (expression, read-only)`);
    return;
  }
  const props = Object.entries(n.props).map(([k, v]) => propText(k, v));
  if (n.spreads) props.push("{...spread}");
  const onlyText = n.children.length === 1 && n.children[0].kind === "text";
  const head = `${pad}<${n.name}${props.length ? ` ${props.join(" ")}` : ""}>`;
  if (!n.children.length) {
    lines.push(`${head.slice(0, -1)} /> [${n.id}]`);
  } else if (onlyText) {
    lines.push(`${head}${n.children[0].text}</${n.name}> [${n.id}]`);
  } else if (depth >= max) {
    lines.push(`${head}… ${n.children.length} children [${n.id}]`);
  } else {
    lines.push(`${head} [${n.id}]`);
    for (const c of n.children) outlineNode(c, depth + 1, lines, max);
  }
}

export function describeComponent(c: ComponentSpec, verbose = false): string {
  const typeOf = (p: ComponentSpec["props"][number]) => {
    if (p.type === "enum") return p.options!.map((o) => JSON.stringify(o)).join(verbose ? " | " : "|");
    if (p.type === "color") return "color string";
    if (p.type === "colors") return "color string[]";
    if (p.type === "number" && p.min !== undefined) return `number ${p.min}..${p.max}`;
    return p.type === "other" || verbose ? p.typeText : p.type;
  };
  const where = c.library ? `from "${c.library}"` : c.file;
  if (!verbose) {
    const props = c.props.filter((p) => p.name !== "className" && !p.advanced).map((p) => `${p.name}${p.optional ? "?" : ""}: ${typeOf(p)}`);
    const presets = c.presets?.length ? ` presets: ${c.presets.map((p) => p.name).join(", ")}` : "";
    return `${c.name} (${where}) { ${props.join("; ")} }${presets}`;
  }
  const lines = [`${c.name} (${where})`];
  if (c.description) lines.push(c.description);
  for (const p of c.props) {
    const def = p.default !== undefined ? ` = ${JSON.stringify(p.default)}` : "";
    lines.push(`- ${p.name}${p.optional ? "?" : ""}: ${typeOf(p)}${def}${p.advanced ? " (advanced)" : ""}${p.description ? `. ${p.description}` : ""}`);
  }
  if (c.presets?.length) {
    lines.push("", "Presets (apply_preset, or copy the values):");
    for (const p of c.presets) {
      // only what differs from the defaults: short and readable
      const diff = Object.fromEntries(Object.entries(p.props).filter(([k, v]) => JSON.stringify(c.props.find((x) => x.name === k)?.default) !== JSON.stringify(v)));
      lines.push(`- ${p.name}: ${Object.keys(diff).length ? JSON.stringify(diff) : "(defaults)"}`);
    }
  }
  return lines.join("\n");
}
