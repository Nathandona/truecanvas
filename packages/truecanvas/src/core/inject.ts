import MagicString from "magic-string";
import { idOf, parseModule, walk } from "./ast.js";

/**
 * Stamps every JSX element in a canvas file with `data-tc="line:col"` so the
 * in-frame runtime can map rendered DOM back to the exact JSX in the source.
 * Inserted on the same line, so stack traces and line numbers stay intact.
 * App files (pages, layouts) pass their project-relative path: their ids are
 * `file#line:col`, so they never collide with the canvas file's own ids.
 */
export function injectIds(source: string, file?: string): string {
  let ast;
  try {
    ast = parseModule(source);
  } catch {
    return source; // let the real compiler report the syntax error
  }
  const s = new MagicString(source);
  walk(ast, (node) => {
    if (node.type !== "JSXOpeningElement") return;
    if (node.attributes.some((a) => a.type === "JSXAttribute" && a.name.name === "data-tc")) return;
    const id = file ? `${file}#${idOf(node)}` : idOf(node);
    // after type arguments: `<Select<Opt> …>`
    s.appendLeft((node.typeParameters ?? node.name).end!, ` data-tc="${id}"`);
  });
  return s.toString();
}
