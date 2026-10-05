import { jsxName, parseModule, walk, type t } from "./ast.js";
import { buildNode, readImports, topLevelNames } from "./parse.js";
import type { CanvasDoc, CanvasFrame, CanvasNode } from "./types.js";

export interface ReturnInfo {
  ast: t.File;
  /** the JSX the default export returns */
  node: t.JSXElement | t.JSXFragment;
  /** plain composition: imported components, tags, literals (and `{children}` in layouts) */
  pure: boolean;
  /** names bound by value imports */
  imported: Set<string>;
}

/**
 * The JSX a page or layout's default export returns, when it is a plain
 * function whose body is a single `return` (no hooks, data or conditions).
 */
export function defaultReturn(source: string, layout: boolean): ReturnInfo | null {
  let ast: t.File;
  try {
    ast = parseModule(source);
  } catch {
    return null;
  }
  let fn: t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression | null = null;
  const decls = new Map<string, t.Node>();
  for (const stmt of ast.program.body) {
    if (stmt.type === "FunctionDeclaration" && stmt.id) decls.set(stmt.id.name, stmt);
    if (stmt.type === "VariableDeclaration") for (const d of stmt.declarations) if (d.id.type === "Identifier" && d.init) decls.set(d.id.name, d.init);
  }
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ExportDefaultDeclaration") continue;
    const d = stmt.declaration;
    const target = d.type === "Identifier" ? decls.get(d.name) : d;
    if (target && (target.type === "FunctionDeclaration" || target.type === "ArrowFunctionExpression" || target.type === "FunctionExpression")) fn = target;
  }
  if (!fn) return null;
  let ret: t.Node | null = null;
  let simple = !fn.async;
  if (fn.body.type !== "BlockStatement") ret = fn.body;
  else {
    const body = fn.body.body.filter((s) => s.type !== "EmptyStatement");
    const last = body[body.length - 1];
    if (last?.type !== "ReturnStatement") return null;
    if (body.length !== 1) simple = false; // logic before the return
    ret = last.argument ?? null;
  }
  while (ret?.type === "ParenthesizedExpression") ret = (ret as t.ParenthesizedExpression).expression;
  if (!ret || (ret.type !== "JSXElement" && ret.type !== "JSXFragment")) return null;

  const imported = new Set<string>();
  for (const stmt of ast.program.body) {
    if (stmt.type !== "ImportDeclaration" || stmt.importKind === "type") continue;
    for (const s of stmt.specifiers) if (!(s.type === "ImportSpecifier" && s.importKind === "type")) imported.add(s.local.name);
  }

  let pure = simple;
  walk(ret, (n) => {
    if (n.type === "JSXOpeningElement") {
      const name = jsxName(n.name);
      const root = name.split(".")[0];
      if ((/^[A-Z]/.test(name) || name.includes(".")) && !imported.has(root)) pure = false;
    }
    if (n.type === "JSXExpressionContainer") {
      const e = n.expression;
      const ok =
        e.type === "JSXEmptyExpression" ||
        e.type === "StringLiteral" ||
        e.type === "NumericLiteral" ||
        e.type === "BooleanLiteral" ||
        (e.type === "TemplateLiteral" && e.expressions.length === 0) ||
        (layout && e.type === "Identifier" && e.name === "children") ||
        e.type === "JSXElement" ||
        e.type === "JSXFragment";
      if (!ok) pure = false;
    }
    if (n.type === "JSXSpreadAttribute") pure = false;
  });
  return { ast, node: ret, pure, imported };
}

/** Prefixes every id in a tree with its file, matching the ids the loader stamps on app files. */
function qualify(node: CanvasNode, file: string) {
  node.id = `${file}#${node.id}`;
  for (const c of node.children) qualify(c, file);
}

/**
 * An editable view of a page or layout file, shaped like a canvas doc with one
 * frame, so the canvas editing engine works on it unchanged. The frame stands
 * for the file; its single child is the JSX the component returns.
 * Null when the file isn't plain composition.
 */
export function parseSourceDoc(file: string, source: string, layout: boolean): CanvasDoc | null {
  const info = defaultReturn(source, layout);
  if (!info || !info.pure) return null;
  const root = buildNode(info.node, source, [0, 0]);
  qualify(root, file);
  const frame: CanvasFrame = {
    ...root,
    id: `${file}#file`,
    kind: "component",
    name: "File",
    props: {},
    attrs: [],
    children: [root],
    path: [0],
    frameName: file,
    x: 0,
    y: 0,
    width: 0,
    height: null,
    theme: null,
    device: null,
    page: null,
    from: null,
    component: null,
    link: null,
  };
  const directives = info.ast.program.directives;
  return {
    name: file,
    file,
    frames: [frame],
    imports: readImports(info.ast),
    canvasNode: null,
    prologueEnd: directives.length ? directives[directives.length - 1].end! : 0,
    declared: topLevelNames(info.ast),
  };
}

/** The file a node id belongs to, for ids of page/layout layers (`file#line:col`). */
export function fileOfId(id: string): string | null {
  const i = id.lastIndexOf("#");
  if (i <= 0) return null;
  const file = id.slice(0, i);
  return /\.[jt]sx?$/.test(file) ? file : null;
}

type Fn = t.FunctionDeclaration | t.ArrowFunctionExpression | t.FunctionExpression;

/** forwardRef(fn), memo(fn), React.forwardRef(fn): the function inside. */
function unwrapFn(n: t.Node | null | undefined): Fn | null {
  if (!n) return null;
  if (n.type === "FunctionDeclaration" || n.type === "ArrowFunctionExpression" || n.type === "FunctionExpression") return n;
  if (n.type === "CallExpression") {
    const callee = n.callee.type === "MemberExpression" && n.callee.property.type === "Identifier" ? n.callee.property.name : n.callee.type === "Identifier" ? n.callee.name : "";
    if (/^(forwardRef|memo)$/.test(callee)) return unwrapFn(n.arguments[0] as t.Node);
  }
  if (n.type === "TSAsExpression" || n.type === "TSSatisfiesExpression") return unwrapFn(n.expression);
  return null;
}

/** The JSX a component finally returns: its expression body, or its last top-level `return`. */
function lastReturn(fn: Fn): t.JSXElement | t.JSXFragment | null {
  let ret: t.Node | null | undefined = null;
  if (fn.body.type !== "BlockStatement") ret = fn.body;
  else for (const stmt of fn.body.body) if (stmt.type === "ReturnStatement") ret = stmt.argument;
  while (ret?.type === "ParenthesizedExpression") ret = ret.expression;
  return ret && (ret.type === "JSXElement" || ret.type === "JSXFragment") ? ret : null;
}

/** Exported function components of a module (capitalized names), with the JSX each returns. */
export function exportedComponents(ast: t.File): { name: string; jsx: t.JSXElement | t.JSXFragment }[] {
  const local = new Map<string, t.Node>();
  for (const stmt of ast.program.body) {
    const decl = stmt.type === "ExportNamedDeclaration" && stmt.declaration ? stmt.declaration : stmt;
    if (decl.type === "FunctionDeclaration" && decl.id) local.set(decl.id.name, decl);
    if (decl.type === "VariableDeclaration") for (const d of decl.declarations) if (d.id.type === "Identifier" && d.init) local.set(d.id.name, d.init);
  }
  const names: string[] = [];
  for (const stmt of ast.program.body) {
    if (stmt.type === "ExportNamedDeclaration") {
      const d = stmt.declaration;
      if (d?.type === "FunctionDeclaration" && d.id) names.push(d.id.name);
      if (d?.type === "VariableDeclaration") for (const v of d.declarations) if (v.id.type === "Identifier") names.push(v.id.name);
      for (const sp of stmt.specifiers) if (sp.type === "ExportSpecifier") names.push(sp.local.name);
    }
    if (stmt.type === "ExportDefaultDeclaration") {
      const d = stmt.declaration;
      if (d.type === "Identifier") names.push(d.name);
      else if (d.type === "FunctionDeclaration" && d.id) names.push(d.id.name);
    }
  }
  const out: { name: string; jsx: t.JSXElement | t.JSXFragment }[] = [];
  for (const name of [...new Set(names)]) {
    if (!/^[A-Z]/.test(name)) continue;
    const fn = unwrapFn(local.get(name));
    const jsx = fn && lastReturn(fn);
    if (jsx) out.push({ name, jsx });
  }
  return out;
}

/**
 * An editable view of a component module: one frame per exported component,
 * holding the JSX it returns. Logic around it is fine; expressions inside the
 * JSX (`{children}`, `{title}`) are read-only layers.
 */
export function parseModuleDoc(file: string, source: string): CanvasDoc | null {
  let ast: t.File;
  try {
    ast = parseModule(source);
  } catch {
    return null;
  }
  const comps = exportedComponents(ast);
  if (!comps.length) return null;
  const frames: CanvasFrame[] = comps.map((c, i) => {
    const root = buildNode(c.jsx, source, [i, 0]);
    qualify(root, file);
    return {
      ...root,
      id: `${file}#${c.name}`,
      kind: "component",
      name: "File",
      props: {},
      attrs: [],
      children: [root],
      path: [i],
      frameName: c.name,
      x: 0,
      y: 0,
      width: 0,
      height: null,
      theme: null,
      device: null,
      page: null,
      from: null,
      component: null,
      link: null,
    };
  });
  const directives = ast.program.directives;
  return {
    name: file,
    file,
    frames,
    imports: readImports(ast),
    canvasNode: null,
    prologueEnd: directives.length ? directives[directives.length - 1].end! : 0,
    declared: topLevelNames(ast),
  };
}

/** Pages and layouts edit as plain composition; any other file as a component module. */
export function parseTargetDoc(file: string, source: string): CanvasDoc | null {
  const base = file.split("/").pop() ?? "";
  if (/^page\.[jt]sx?$/.test(base)) return parseSourceDoc(file, source, false);
  if (/^layout\.[jt]sx?$/.test(base)) return parseSourceDoc(file, source, true);
  return parseModuleDoc(file, source);
}
