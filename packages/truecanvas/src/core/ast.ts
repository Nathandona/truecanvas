import { parse } from "@babel/parser";
import type * as t from "@babel/types";

export type { t };

export function parseModule(source: string): t.File {
  return parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
    errorRecovery: false,
  });
}

/** Stable-for-this-source id of a JSX element: "line:col" of its opening `<`. */
export function idOf(node: t.Node): string {
  const loc = node.loc!.start;
  return `${loc.line}:${loc.column}`;
}

export function jsxName(name: t.JSXOpeningElement["name"]): string {
  if (name.type === "JSXIdentifier") return name.name;
  if (name.type === "JSXNamespacedName") return `${name.namespace.name}:${name.name.name}`;
  return `${jsxName(name.object as t.JSXOpeningElement["name"])}.${name.property.name}`;
}

/** Depth-first walk over every AST node. Return false from `visit` to skip children. */
export function walk(node: unknown, visit: (n: t.Node, parent: t.Node | null) => boolean | void, parent: t.Node | null = null): void {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) walk(child, visit, parent);
    return;
  }
  const n = node as t.Node;
  if (typeof n.type !== "string") return;
  if (visit(n, parent) === false) return;
  for (const key of Object.keys(n)) {
    if (key === "loc" || key === "leadingComments" || key === "trailingComments" || key === "innerComments" || key === "extra") continue;
    const value = (n as unknown as Record<string, unknown>)[key];
    if (value && typeof value === "object") walk(value, visit, n);
  }
}

export function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name) || name.includes(".");
}

/**
 * An import statement with its module specifier changed, quotes kept. Splices
 * by index: `$` sequences in paths are never read as replacement patterns.
 */
export function rewriteImportSource(statement: string, from: string, to: string): string {
  if (from === to) return statement;
  for (const q of ['"', "'"]) {
    const needle = `${q}${from}${q}`;
    const i = statement.indexOf(needle);
    if (i >= 0) return `${statement.slice(0, i)}${q}${to}${q}${statement.slice(i + needle.length)}`;
  }
  return statement;
}
