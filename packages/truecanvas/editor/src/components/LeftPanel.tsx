import { memo, useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { Braces, Brackets, ChevronRight, Columns3, Component, Eye, EyeOff, Frame, LayoutGrid, Lock, LockOpen, Pencil, Rows3, Search, Square, Type, X } from "lucide-react";
import { BranchPill } from "./GitPanel";
import { useStore, layerName, layerKey } from "../lib/store";
import { acceptsChildren } from "../lib/actions";
import { CanvasMenu } from "./CanvasMenu";
import { type CanvasNode } from "../lib/api";
import { layoutLabel } from "../lib/classes";
import { Pages } from "./Pages";
import { ComponentsList } from "./Assets";

export function LeftPanel() {
  const leftTab = useStore((s) => s.leftTab);
  const components = useStore((s) => s.components);
  const project = useStore((s) => s.projectName);
  return (
    <aside className="panel left">
      <div className="panel-head">
        <svg className="logo" viewBox="0 0 64 64" aria-hidden>
          <path fill="#f2774a" fillRule="evenodd" d="M4 5h56v18H4z M22 14h20v46H22z" />
        </svg>
        <span className="project-name" title={project}>
          {project}
        </span>
        <span style={{ marginLeft: "auto" }} />
        <BranchPill />
      </div>
      <Pages />
      <div style={{ padding: "8px 10px" }}>
        <div className="tabs" role="tablist">
          <button role="tab" aria-selected={leftTab === "layers"} className={`tab${leftTab === "layers" ? " on" : ""}`} onClick={() => useStore.setState({ leftTab: "layers" })}>
            Layers
          </button>
          <button role="tab" aria-selected={leftTab === "components"} className={`tab${leftTab === "components" ? " on" : ""}`} onClick={() => useStore.setState({ leftTab: "components" })}>
            Assets <span className="faint">{components.length || ""}</span>
          </button>
        </div>
      </div>
      {leftTab === "layers" ? <Layers /> : <ComponentsList />}
    </aside>
  );
}

// ---------- Layers ----------

/** The layer being dragged in the tree (there is one tree, so module state is enough). */
let draggingLayer: string | null = null;

/** Search matches, computed once for the whole tree and shared by its rows. */
const LayerMatches = createContext<Set<string> | null>(null);

async function dropLayer() {
  const s = useStore.getState();
  const from = draggingLayer;
  const target = s.layerDrop;
  draggingLayer = null;
  useStore.setState({ layerDrop: null });
  if (!from || !target || from === target.id) return;
  const t = s.index.get(target.id);
  if (!t) return;
  if (target.where === "inside") await s.run({ op: "move", canvas: s.canvas!, id: from, parent: target.id });
  else if (t.parent) {
    const siblings = t.parent.children.filter((c) => c.id !== from);
    const i = siblings.findIndex((c) => c.id === target.id) + (target.where === "after" ? 1 : 0);
    await s.run({ op: "move", canvas: s.canvas!, id: from, parent: t.parent.id, index: i });
  }
}

function Layers() {
  const doc = useStore((s) => s.doc);
  const query = useStore((s) => s.layerQuery);
  const matches = useLayerMatches();
  if (!doc) return <div className="empty">Loading…</div>;
  if (doc.error) return <div className="empty">The canvas file has a syntax error:<br />{doc.error}</div>;
  if (!doc.frames.length) return <div className="empty">No frames yet.<br />Press F and drag on the canvas.</div>;
  return (
    <>
      <LayerSearch />
      <LayerMatches.Provider value={matches}>
        <div className="scroll tree" role="tree" onDragEnd={() => useStore.setState({ layerDrop: null })}>
          {doc.frames.map((f) => (
            <LayerRow key={f.id} node={f} depth={0} isFrame />
          ))}
          {matches && matches.size === 0 && <div className="empty">No layers match “{query}”.</div>}
        </div>
      </LayerMatches.Provider>
    </>
  );
}

function LayerSearch() {
  const query = useStore((s) => s.layerQuery);
  return (
    <div className="layer-search">
      <div className="field">
        <span className="prefix">
          <Search size={13} />
        </span>
        <input
          value={query}
          placeholder="Search layers"
          aria-label="Search layers"
          onChange={(e) => useStore.setState({ layerQuery: e.target.value })}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Escape") useStore.setState({ layerQuery: "" });
          }}
        />
        {query && (
          <button className="icon-btn sm" aria-label="Clear search" onClick={() => useStore.setState({ layerQuery: "" })}>
            <X size={12} />
          </button>
        )}
      </div>
    </div>
  );
}

/** Text a layer can be found by: its name, custom name, text and string props. */
function searchable(n: CanvasNode): string {
  const parts = [n.name, layerName(n), n.text ?? ""];
  for (const v of Object.values(n.props)) if (v.kind === "string") parts.push(v.value);
  return parts.join(" ").toLowerCase();
}

/** Ids to show while searching: matches plus their ancestors (null = no search). */
function useLayerMatches(): Set<string> | null {
  const query = useStore((s) => s.layerQuery.trim().toLowerCase());
  const index = useStore((s) => s.index);
  return useMemo(() => {
    if (!query) return null;
    const show = new Set<string>();
    for (const [id, e] of index) {
      if (!searchable(e.node).includes(query)) continue;
      show.add(id);
      let p = e.parent;
      while (p) {
        show.add(p.id);
        p = index.get(p.id)?.parent ?? null;
      }
      show.add(e.frame.id);
    }
    return show;
  }, [query, index]);
}

const LayerRow = memo(function LayerRow({ node, depth, isFrame }: { node: CanvasNode; depth: number; isFrame?: boolean }) {
  const selected = useStore((s) => s.selection.includes(node.id));
  const hovered = useStore((s) => s.hover === node.id);
  const matches = useContext(LayerMatches);
  const searching = matches !== null;
  // only the row under the drag re-renders as the drop target moves
  const dropWhere = useStore((s) => (s.layerDrop?.id === node.id ? s.layerDrop.where : null));
  const open = useStore((s) => s.expanded.has(node.id)) || searching;
  const key = layerKey(node);
  const hidden = useStore((s) => s.hidden.has(key));
  const locked = useStore((s) => s.locked.has(key));
  const renaming = useStore((s) => s.renamingLayer === node.id);
  const flashing = useStore((s) => s.flashes.some((f) => f.id === node.id));
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const kids = node.children.filter((c) => (c.kind !== "text" || node.children.length > 1) && (!matches || matches.has(c.id)));
  const hasKids = kids.length > 0;
  const hit = searching && searchable(node).includes(useStore.getState().layerQuery.trim().toLowerCase());

  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const ex = new Set(useStore.getState().expanded);
    if (ex.has(node.id)) ex.delete(node.id);
    else ex.add(node.id);
    useStore.setState({ expanded: ex });
  };
  const onClick = (e: React.MouseEvent) => {
    const s = useStore.getState();
    if (e.shiftKey || e.metaKey || e.ctrlKey) s.select(s.selection.includes(node.id) ? s.selection.filter((i) => i !== node.id) : [...s.selection, node.id], { reveal: false });
    else s.select([node.id], { reveal: false });
  };

  if (matches && !matches.has(node.id)) return null;
  const { icon, hint } = describe(node, !!isFrame);
  const cls = ["layer", isFrame ? "frame" : node.kind, selected ? "selected" : "", hovered ? "hovered" : "", hidden ? "is-hidden" : "", locked ? "is-locked" : "", hit ? "match" : ""];
  const canRename = node.kind === "component" || node.kind === "element";
  const rename = (value: string) => {
    useStore.setState({ renamingLayer: null });
    const s = useStore.getState();
    const v = value.trim();
    if (isFrame) {
      if (v && v !== layerName(node)) void s.run({ op: "update_frame", canvas: s.canvas!, frame: (node as CanvasNode & { frameName: string }).frameName, name: v }, { select: false });
    } else if (v !== (node.props["data-name"]?.kind === "string" ? node.props["data-name"].value : "")) {
      // custom layer names live in the TSX as data-name, so agents see them too
      void s.run({ op: "set_props", canvas: s.canvas!, id: node.id, props: { "data-name": v || null } }, { select: false });
    }
  };
  if (dropWhere) cls.push(`drop-${dropWhere}`);
  const draggable = !isFrame && node.kind !== "text";

  return (
    <>
      <div
        ref={ref}
        role="treeitem"
        aria-selected={selected}
        aria-expanded={hasKids ? open : undefined}
        className={cls.join(" ")}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          const s = useStore.getState();
          // like the canvas: right-click acts on the selection, or selects the row first
          if (!s.selection.includes(node.id)) s.select([node.id], { reveal: false });
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        onDoubleClick={() => (isFrame || canRename) && useStore.setState({ renamingLayer: node.id })}
        onPointerEnter={() => useStore.setState({ hover: node.id })}
        onPointerLeave={() => useStore.getState().hover === node.id && useStore.setState({ hover: null })}
        draggable={draggable}
        onDragStart={(e) => {
          draggingLayer = node.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
        }}
        onDragOver={(e) => {
          if (!draggingLayer || draggingLayer === node.id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          const container = isFrame || acceptsChildren(node);
          const where = isFrame ? "inside" : container && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "before" : "after";
          if (dropWhere !== where) useStore.setState({ layerDrop: { id: node.id, where } });
        }}
        onDrop={(e) => {
          e.preventDefault();
          void dropLayer();
        }}
      >
        <span aria-hidden className={`twisty${open ? " open" : ""}`} onClick={hasKids ? toggle : undefined} style={{ visibility: hasKids ? "visible" : "hidden" }}>
          <ChevronRight size={12} />
        </span>
        <span className="icon">{icon}</span>
        {renaming ? (
          <input
            className="layer-rename"
            autoFocus
            defaultValue={layerName(node)}
            onFocus={(e) => e.target.select()}
            onClick={(e) => e.stopPropagation()}
            onBlur={(e) => rename(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              if (e.key === "Escape") useStore.setState({ renamingLayer: null });
            }}
          />
        ) : (
          <>
            <span className="name">{layerName(node)}</span>
            {hint && <span className="hint">{hint}</span>}
          </>
        )}
        {flashing && <span className="flash-dot" title="Changed by an agent" />}
        {node.kind !== "text" && !renaming && (
          <span className="layer-flags">
            <button
              className={`flag${locked ? " on" : ""}`}
              aria-label={locked ? "Unlock layer" : "Lock layer"}
              title={locked ? "Unlock" : "Lock (can't be clicked on the canvas)"}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().toggleLayerFlag("locked", node);
              }}
            >
              {locked ? <Lock size={12} /> : <LockOpen size={12} />}
            </button>
            <button
              className={`flag${hidden ? " on" : ""}`}
              aria-label={hidden ? "Show layer" : "Hide layer"}
              title={hidden ? "Show" : "Hide in the editor (your code is unchanged)"}
              onClick={(e) => {
                e.stopPropagation();
                useStore.getState().toggleLayerFlag("hidden", node);
              }}
            >
              {hidden ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </span>
        )}
      </div>
      {menu && (
        <CanvasMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          extra={[
            ...(isFrame || canRename ? [{ label: "Rename", icon: <Pencil size={14} />, onSelect: () => useStore.setState({ renamingLayer: node.id }) }] : []),
            ...(node.kind !== "text"
              ? [
                  { label: hidden ? "Show" : "Hide", icon: hidden ? <Eye size={14} /> : <EyeOff size={14} />, kbd: "", onSelect: () => useStore.getState().toggleLayerFlag("hidden", node) },
                  { label: locked ? "Unlock" : "Lock", icon: locked ? <LockOpen size={14} /> : <Lock size={14} />, onSelect: () => useStore.getState().toggleLayerFlag("locked", node) },
                ]
              : []),
          ]}
        />
      )}
      {open &&
        hasKids &&
        kids.map((c) => <LayerRow key={c.id} node={c} depth={depth + 1} />)}
    </>
  );
});

function describe(node: CanvasNode, isFrame: boolean): { icon: React.ReactNode; hint: string | null } {
  if (isFrame) return { icon: <Frame size={13} />, hint: null };
  if (node.kind === "component") {
    const p = node.props.title ?? node.props.label ?? node.props.name;
    return { icon: <Component size={13} />, hint: p?.kind === "string" ? p.value : null };
  }
  if (node.kind === "text") return { icon: <Type size={13} />, hint: null };
  if (node.kind === "expression") return { icon: <Braces size={13} />, hint: null };
  if (node.kind === "fragment") return { icon: <Brackets size={13} />, hint: null };
  const cls = node.props.className?.kind === "string" ? node.props.className.value : undefined;
  const label = layoutLabel(cls);
  const onlyText = node.children.length > 0 && node.children.every((c) => c.kind === "text");
  const icon = label === "Row" ? <Columns3 size={13} /> : label === "Stack" ? <Rows3 size={13} /> : label === "Grid" ? <LayoutGrid size={13} /> : onlyText ? <Type size={13} /> : <Square size={13} />;
  return { icon, hint: onlyText ? (node.children[0].text ?? null) : label };
}
