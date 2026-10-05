import { idOf, jsxName, parseModule, walk, isComponentName, type t } from "./ast.js";
import type { AttrRange, CanvasDoc, CanvasFrame, CanvasNode, ImportInfo, PropValue } from "./types.js";

export function parseCanvas(name: string, file: string, source: string): CanvasDoc {
  let ast: t.File;
  try {
    ast = parseModule(source);
  } catch (err) {
    return { name, file, frames: [], imports: [], canvasNode: null, prologueEnd: 0, declared: [], error: (err as Error).message };
  }

  const imports = readImports(ast);
  const directives = ast.program.directives;
  const prologueEnd = directives.length ? directives[directives.length - 1].end! : 0;
  const declared = topLevelNames(ast);

  let canvasEl: t.JSXElement | null = null;
  walk(ast, (node) => {
    if (canvasEl) return false;
    if (node.type === "JSXElement" && jsxName(node.openingElement.name) === "Canvas") {
      canvasEl = node;
      return false;
    }
  });

  if (!canvasEl) {
    return { name, file, frames: [], imports, canvasNode: null, prologueEnd, declared, error: "No <Canvas> element found in the default export." };
  }

  const canvasNode = buildNode(canvasEl, source, []);
  const frames: CanvasFrame[] = [];
  let frameIndex = 0;
  for (const child of canvasNode.children) {
    if (child.kind !== "component" || child.name !== "Frame") continue;
    const path = [frameIndex++];
    reindex(child, path);
    frames.push({
      ...child,
      frameName: str(child.props.name) ?? `Frame ${frameIndex}`,
      x: num(child.props.x) ?? 0,
      y: num(child.props.y) ?? 0,
      width: num(child.props.width) ?? 1024,
      height: num(child.props.height) ?? null,
      theme: (str(child.props.theme) as "light" | "dark" | undefined) ?? null,
      device: str(child.props.device) ?? null,
      page: str(child.props.page) ?? null,
      from: str(child.props.from) ?? null,
      component: str(child.props.component) ?? null,
      link: null,
    });
  }
  return { name, file, frames, imports, canvasNode, prologueEnd, declared };
}

export function readImports(ast: t.File): ImportInfo[] {
  const imports: ImportInfo[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration") continue;
    const typeOnly = stmt.importKind === "type";
    const named = stmt.specifiers.filter((s): s is t.ImportSpecifier => s.type === "ImportSpecifier");
    const def = stmt.specifiers.find((s) => s.type === "ImportDefaultSpecifier");
    const ns = stmt.specifiers.find((s) => s.type === "ImportNamespaceSpecifier");
    imports.push({
      source: stmt.source.value,
      typeOnly,
      // value bindings only: `import type` and `{ type X }` don't exist at runtime
      names: typeOnly ? [] : [...named.filter((s) => s.importKind !== "type").map((s) => s.local.name), ...(ns ? [ns.local.name] : [])],
      defaultName: def ? def.local.name : null,
      start: stmt.start!,
      end: stmt.end!,
      lastSpecifierEnd: named.length && !typeOnly ? named[named.length - 1].end! : null,
    });
  }
  return imports;
}

/** Names declared at the top level of the module (local components, consts). */
export function topLevelNames(ast: t.File): string[] {
  const out: string[] = [];
  for (let stmt of ast.program.body) {
    if ((stmt.type === "ExportNamedDeclaration" || stmt.type === "ExportDefaultDeclaration") && stmt.declaration) stmt = stmt.declaration as t.Statement;
    if ((stmt.type === "FunctionDeclaration" || stmt.type === "ClassDeclaration") && stmt.id) out.push(stmt.id.name);
    if (stmt.type === "VariableDeclaration") for (const d of stmt.declarations) if (d.id.type === "Identifier") out.push(d.id.name);
  }
  return out;
}

export function reindex(node: CanvasNode, path: number[]) {
  node.path = path;
  node.children.forEach((c, i) => reindex(c, [...path, i]));
}

function str(v: PropValue | undefined) {
  return v?.kind === "string" ? v.value : undefined;
}
function num(v: PropValue | undefined) {
  return v?.kind === "number" ? v.value : undefined;
}

export function buildNode(el: t.JSXElement | t.JSXFragment, source: string, path: number[]): CanvasNode {
  const children: CanvasNode[] = [];
  for (const child of el.children) {
    const built = buildChild(child, source, [...path, children.length]);
    if (built) children.push(built);
  }

  if (el.type === "JSXFragment") {
    return {
      id: idOf(el),
      kind: "fragment",
      name: "Fragment",
      props: {},
      spreads: 0,
      children,
      start: el.start!,
      end: el.end!,
      line: el.loc!.start.line,
      col: el.loc!.start.column,
      path,
      attrs: [],
      nameEnd: el.openingFragment.end! - 1,
      openEnd: el.openingFragment.end!,
      selfClosing: false,
      closeStart: el.closingFragment.start!,
    };
  }

  const open = el.openingElement;
  const name = jsxName(open.name);
  const props: Record<string, PropValue> = {};
  const attrs: AttrRange[] = [];
  let spreads = 0;
  for (const attr of open.attributes) {
    if (attr.type === "JSXSpreadAttribute") {
      spreads++;
      continue;
    }
    const attrName = attr.name.type === "JSXIdentifier" ? attr.name.name : `${attr.name.namespace.name}:${attr.name.name.name}`;
    if (attrName === "data-tc") continue;
    const literal = classLiteral(attr.value);
    attrs.push({ name: attrName, start: attr.start!, end: attr.end!, ...(literal ? { literal: { start: literal.start!, end: literal.end! } } : {}) });
    props[attrName] = literal ? { kind: "string", value: literal.type === "StringLiteral" ? literal.value : literal.quasis.map((q) => q.value.cooked ?? "").join("") } : readValue(attr.value, source);
  }

  return {
    id: idOf(open),
    kind: isComponentName(name) ? "component" : "element",
    name,
    props,
    spreads,
    children,
    start: el.start!,
    end: el.end!,
    line: open.loc!.start.line,
    col: open.loc!.start.column,
    path,
    attrs,
    // after type arguments: `<Select<Opt> …>`
    nameEnd: (open.typeParameters ?? open.name).end!,
    openEnd: open.end!,
    selfClosing: open.selfClosing,
    closeStart: el.closingElement ? el.closingElement.start! : open.end!,
  };
}

function buildChild(child: t.JSXElement["children"][number], source: string, path: number[]): CanvasNode | null {
  if (child.type === "JSXElement" || child.type === "JSXFragment") return buildNode(child, source, path);
  if (child.type === "JSXText") {
    const text = child.value.replace(/\s+/g, " ").trim();
    if (!text) return null;
    return leaf("text", text, child, path, { text });
  }
  if (child.type === "JSXExpressionContainer") {
    const expr = child.expression;
    if (expr.type === "JSXEmptyExpression") return null; // comment
    if (expr.type === "StringLiteral") return leaf("text", expr.value, child, path, { text: expr.value });
    if (expr.type === "TemplateLiteral" && expr.expressions.length === 0) {
      const text = expr.quasis.map((q) => q.value.cooked ?? "").join("");
      return leaf("text", text, child, path, { text });
    }
    return leaf("expression", source.slice(expr.start!, expr.end!), child, path, {});
  }
  if (child.type === "JSXSpreadChild") return leaf("expression", source.slice(child.start!, child.end!), child, path, {});
  return null;
}

function leaf(kind: "text" | "expression", name: string, node: t.Node, path: number[], extra: { text?: string }): CanvasNode {
  return {
    id: `${kind[0]}${idOf(node)}`,
    kind,
    name,
    props: {},
    spreads: 0,
    children: [],
    ...extra,
    start: node.start!,
    end: node.end!,
    line: node.loc!.start.line,
    col: node.loc!.start.column,
    path,
    attrs: [],
    nameEnd: node.end!,
    openEnd: node.end!,
    selfClosing: true,
    closeStart: node.end!,
  };
}

const CLASS_HELPERS = new Set(["cn", "clsx", "cx", "twMerge", "classNames", "classnames"]);

/** `cn("static classes", ...)`: the static string, the part a designer edits. */
function classLiteral(value: t.JSXAttribute["value"]): t.StringLiteral | t.TemplateLiteral | null {
  if (value?.type !== "JSXExpressionContainer") return null;
  const e = value.expression;
  if (e.type !== "CallExpression" || e.callee.type !== "Identifier" || !CLASS_HELPERS.has(e.callee.name)) return null;
  const first = e.arguments[0];
  if (first?.type === "StringLiteral") return first;
  if (first?.type === "TemplateLiteral" && first.expressions.length === 0) return first;
  return null;
}

function readValue(value: t.JSXAttribute["value"], source: string): PropValue {
  if (value == null) return { kind: "boolean", value: true };
  if (value.type === "StringLiteral") return { kind: "string", value: value.value };
  if (value.type === "JSXExpressionContainer") {
    const e = value.expression;
    if (e.type === "StringLiteral") return { kind: "string", value: e.value };
    if (e.type === "NumericLiteral") return { kind: "number", value: e.value };
    if (e.type === "BooleanLiteral") return { kind: "boolean", value: e.value };
    if (e.type === "UnaryExpression" && e.operator === "-" && e.argument.type === "NumericLiteral") {
      return { kind: "number", value: -e.argument.value };
    }
    if (e.type === "TemplateLiteral" && e.expressions.length === 0) {
      return { kind: "string", value: e.quasis.map((q) => q.value.cooked ?? "").join("") };
    }
    if (e.type === "ArrayExpression") {
      const items: (string | number | boolean)[] = [];
      for (const el of e.elements) {
        if (el?.type === "StringLiteral" || el?.type === "NumericLiteral" || el?.type === "BooleanLiteral") items.push(el.value);
        else if (el?.type === "UnaryExpression" && el.operator === "-" && el.argument.type === "NumericLiteral") items.push(-el.argument.value);
        else return { kind: "expression", code: source.slice(e.start!, e.end!) };
      }
      return { kind: "array", value: items };
    }
    if (e.type === "JSXEmptyExpression") return { kind: "expression", code: "" };
    return { kind: "expression", code: source.slice(e.start!, e.end!) };
  }
  return { kind: "expression", code: source.slice(value.start!, value.end!) };
}

/** Every node in the doc, depth-first, including frames. */
export function* allNodes(doc: CanvasDoc): Generator<{ node: CanvasNode; parent: CanvasNode | null; frame: CanvasFrame }> {
  for (const frame of doc.frames) {
    yield { node: frame, parent: null, frame };
    const stack: { node: CanvasNode; parent: CanvasNode }[] = frame.children.map((c) => ({ node: c, parent: frame as CanvasNode })).reverse();
    while (stack.length) {
      const item = stack.pop()!;
      yield { ...item, frame };
      for (let i = item.node.children.length - 1; i >= 0; i--) stack.push({ node: item.node.children[i], parent: item.node });
    }
  }
}

export function findNode(doc: CanvasDoc, id: string) {
  for (const entry of allNodes(doc)) if (entry.node.id === id) return entry;
  return null;
}

export function findFrame(doc: CanvasDoc, ref: string): CanvasFrame | null {
  return doc.frames.find((f) => f.id === ref || f.frameName === ref) ?? null;
}

export function findByPath(doc: CanvasDoc, path: number[]): CanvasNode | null {
  if (!path.length) return null;
  let node: CanvasNode | undefined = doc.frames[path[0]];
  for (const i of path.slice(1)) node = node?.children[i];
  return node ?? null;
}
