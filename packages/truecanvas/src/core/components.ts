import fs from "node:fs";
import path from "node:path";
import { parseModule, walk, type t } from "./ast.js";
import { importSpecifier } from "./catalog.js";
import type { TruecanvasConfig } from "./config.js";
import { EditError, componentNamesIn, indentBlock } from "./edit.js";
import { repoint } from "./routes.js";
import type { CanvasDoc } from "./types.js";

/*
 * Making components from the canvas: a new file in the project's components
 * folder, either a starter or the JSX of selected layers moved out of a page.
 */

/** Folder new components go to: the first `components` glob's static part. */
export function componentsDir(config: TruecanvasConfig): string {
  const glob = config.components[0] ?? "components/**/*.tsx";
  return glob.split("/").filter((p) => !p.includes("*")).join("/") || "components";
}

export const kebab = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .toLowerCase()
    .replace(/^-|-$/g, "");

/** "pricing card" → "PricingCard"; null when it can't be a component name. */
export function componentName(input: string): string | null {
  const name = input
    .trim()
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
  return /^[A-Z][A-Za-z0-9]*$/.test(name) ? name : null;
}

const GLOBALS = new Set(["undefined", "null", "true", "false", "Math", "JSON", "Number", "String", "Boolean", "Date", "Array", "Object", "Intl", "console", "window", "document"]);

/** Identifiers a JSX snippet reads from its surroundings (not counting its own arrow-function params). */
function freeNames(jsx: string): Set<string> {
  const ast = parseModule(`<>${jsx}</>`);
  const out = new Set<string>();
  const visit = (n: t.Node | null | undefined, locals: Set<string>) => {
    if (!n || typeof n !== "object") return;
    switch (n.type) {
      case "Identifier":
        if (!locals.has(n.name)) out.add(n.name);
        return;
      case "MemberExpression":
        visit(n.object, locals);
        if (n.computed) visit(n.property, locals);
        return;
      case "ObjectProperty":
        if (n.computed) visit(n.key, locals);
        visit(n.value, locals);
        return;
      case "ArrowFunctionExpression":
      case "FunctionExpression": {
        const inner = new Set(locals);
        for (const p of n.params) walk(p, (x) => void (x.type === "Identifier" && inner.add(x.name)));
        visit(n.body, inner);
        return;
      }
      case "JSXAttribute":
        visit(n.value as t.Node, locals);
        return;
      case "JSXOpeningElement":
        for (const a of n.attributes) visit(a, locals);
        return;
      case "JSXClosingElement":
        return;
    }
    for (const key of Object.keys(n)) {
      if (key === "loc" || key === "start" || key === "end" || key.endsWith("Comments")) continue;
      const v = (n as unknown as Record<string, unknown>)[key];
      if (Array.isArray(v)) for (const x of v) visit(x as t.Node, locals);
      else if (v && typeof v === "object" && "type" in (v as object)) visit(v as t.Node, locals);
    }
  };
  visit(ast.program, new Set());
  return out;
}

/**
 * Import statements a snippet needs in `toFile`, taken from the imports of the
 * file it comes from. Throws when it uses something defined in that file.
 */
export function importsFor(config: TruecanvasConfig, jsx: string, source: string, doc: CanvasDoc, fromRel: string, toRel: string): string[] {
  const ast = parseModule(source);
  const needed = new Set([...componentNamesIn(jsx), ...freeNames(jsx)]);
  const out: string[] = [];
  for (const name of needed) {
    if (GLOBALS.has(name)) continue;
    const decl = ast.program.body.find(
      (s): s is t.ImportDeclaration => s.type === "ImportDeclaration" && s.importKind !== "type" && s.specifiers.some((sp) => sp.local.name === name),
    );
    if (!decl) {
      if (doc.declared.includes(name)) throw new EditError(`These layers use ${name}, defined in ${path.basename(fromRel)}. Move it to its own file first, or ask your agent to extract the component.`);
      throw new EditError(`These layers use \`${name}\` from the surrounding code, so they can't become a component automatically. Ask your agent to extract it with props.`);
    }
    const sp = decl.specifiers.find((x) => x.local.name === name)!;
    const from = repoint(config, decl.source.value, path.join(config.root, fromRel), path.join(config.root, toRel));
    const what =
      sp.type === "ImportDefaultSpecifier"
        ? name
        : sp.type === "ImportNamespaceSpecifier"
          ? `* as ${name}`
          : `{ ${sp.imported.type === "Identifier" && sp.imported.name !== name ? `${sp.imported.name} as ${name}` : name} }`;
    out.push(`import ${what} from ${JSON.stringify(from)};`);
  }
  return out;
}

export function starterJsx(name: string) {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2");
  return `<div className="flex flex-col gap-2 rounded-xl border border-neutral-200 p-6">\n  <h3 className="text-lg font-semibold">${words}</h3>\n  <p className="text-sm text-neutral-500">Describe it here.</p>\n</div>`;
}

/** The new component file's source. */
export function componentFile(name: string, jsx: string, imports: string[]): string {
  return `${imports.length ? `${imports.join("\n")}\n\n` : ""}export function ${name}() {\n  return (\n${indentBlock(indentBlock(jsx.trim()))}\n  );\n}\n`;
}

/** Path for a new component, refusing to overwrite. */
export function newComponentPath(config: TruecanvasConfig, name: string): string {
  const rel = `${componentsDir(config)}/${kebab(name)}.tsx`;
  if (fs.existsSync(path.join(config.root, rel))) throw new EditError(`${rel} already exists. Pick another name.`);
  return rel;
}

export { importSpecifier };
