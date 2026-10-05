import { ELEMENTS, editComponent, insertElement } from "../lib/elements";
import { ELEMENT_ICONS } from "./Toolbar";
import { openComponentDialog } from "./ComponentDialog";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Braces,
  Brackets,
  Check,
  ChevronRight,
  Columns3,
  Component,
  CopyPlus,
  Eye,
  EyeOff,
  FileCode2,
  FlaskConical,
  Link2,
  Frame,
  LayoutGrid,
  Lock,
  LockOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  Rows3,
  Search,
  Square,
  Trash2,
  Type,
  Waves,
  X,
} from "lucide-react";
import { Tip } from "./controls";
import { BranchPill } from "./GitPanel";
import { useStore, layerName, layerKey } from "../lib/store";
import { acceptsChildren, insertComponent, kbd } from "../lib/actions";
import { CanvasMenu, goToComponent } from "./Canvas";
import { api, type CanvasNode, type ComponentSpec, type Literal } from "../lib/api";
import { layoutLabel } from "../lib/classes";
import { Menu } from "./Menu";

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

// ---------- Pages (one per canvas file) ----------

const slug = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

function Pages() {
  const pages = useStore((s) => s.pages);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("tc:pagesCollapsed") === "1");
  // fits its content until the user drags the divider
  const [height, setHeight] = useState<number | null>(() => Number(localStorage.getItem("tc:pagesHeight")) || null);
  const [creating, setCreating] = useState(false);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [importing, setImporting] = useState(false);
  const toggle = () => {
    setCollapsed(!collapsed);
    localStorage.setItem("tc:pagesCollapsed", collapsed ? "0" : "1");
  };
  const resize = (e: React.PointerEvent) => {
    const startY = e.clientY;
    const list = (e.currentTarget as HTMLElement).previousElementSibling as HTMLElement | null;
    const start = height ?? list?.offsetHeight ?? 120;
    let current = start;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      current = Math.max(56, Math.min(420, start + ev.clientY - startY));
      setHeight(current);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      localStorage.setItem("tc:pagesHeight", String(current));
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <section className="pages">
      <div className="section-bar">
        <button className="section-toggle" onClick={toggle} aria-expanded={!collapsed}>
          <ChevronRight size={12} className={collapsed ? "" : "open"} />
          Pages
        </button>
        <Tip label="New page">
          <button
            className="icon-btn sm"
            aria-label="New page"
            onClick={(e) => {
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
              setAddMenu({ x: r.left - 180, y: r.bottom + 4 });
            }}
          >
            <Plus size={13} />
          </button>
        </Tip>
        {addMenu && (
          <Menu
            x={addMenu.x}
            y={addMenu.y}
            onClose={() => setAddMenu(null)}
            items={[
              { label: "New empty page", icon: <Plus size={14} />, onSelect: () => (setCollapsed(false), setCreating(true)) },
              { label: "Import a page from your app…", icon: <FileCode2 size={14} />, onSelect: () => setImporting(true) },
            ]}
          />
        )}
        {importing && <ImportRoute onClose={() => setImporting(false)} />}
      </div>
      {!collapsed && (
        <>
          <div className="pages-list scroll" style={height ? { height } : { maxHeight: 200, flex: "none" }}>
            {pages.map((p) => (
              <PageRow key={p.name} page={p} />
            ))}
            {creating && (
              <InlineName
                initial=""
                placeholder="page-name"
                onDone={async (v) => {
                  setCreating(false);
                  const name = slug(v);
                  if (!name) return;
                  try {
                    await api.createCanvas(name);
                    useStore.setState({ canvas: name });
                  } catch (err) {
                    useStore.getState().toast((err as Error).message);
                  }
                }}
              />
            )}
          </div>
          <div className="resize-bar" onPointerDown={resize} role="separator" aria-orientation="horizontal" aria-label="Resize pages" />
        </>
      )}
    </section>
  );
}

/** Pick an App Router page to add as a frame on the current canvas. */
function ImportRoute({ onClose }: { onClose: () => void }) {
  const [routes, setRoutes] = useState<{ route: string; file: string; dynamic: boolean }[] | null>(null);
  const [copy, setCopy] = useState(false);
  useEffect(() => {
    void api
      .routes()
      .then((r) => setRoutes(r.routes))
      .catch(() => setRoutes([]));
  }, []);
  const pick = async (route: string) => {
    onClose();
    const s = useStore.getState();
    if (!s.canvas) return;
    const ids = await s.run({ op: "import_route", canvas: s.canvas, route, copy });
    if (ids?.length) setTimeout(() => void import("../lib/actions").then((a) => a.zoomToSelection()), 400);
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" style={{ width: 460 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && onClose())}>
        <div className="modal-title">Add a page from your app</div>
        <div className="seg-choice" role="radiogroup" aria-label="How to add the page">
          <button role="radio" aria-checked={!copy} className={copy ? "" : "on"} onClick={() => setCopy(false)}>
            <strong>
              <Link2 size={13} /> Linked
            </strong>
            <span>The frame is your page. Editing its layers edits page.tsx, tracked by git.</span>
          </button>
          <button role="radio" aria-checked={copy} className={copy ? "on" : ""} onClick={() => setCopy(true)}>
            <strong>
              <FlaskConical size={13} /> Copy
            </strong>
            <span>A free copy in the canvas, for explorations. Your page stays untouched.</span>
          </button>
        </div>
        <div className="dir-list" style={{ height: 240 }}>
          {routes === null && <div className="faint" style={{ padding: 10 }}>Looking for pages…</div>}
          {routes?.length === 0 && <div className="faint" style={{ padding: 10 }}>No App Router pages found.</div>}
          {routes?.map((r) => (
            <button key={r.file} className="dir-row" onClick={() => void pick(r.route)} disabled={r.dynamic} title={r.dynamic ? "Pages with [params] need sample values: not supported yet" : r.file}>
              <FileCode2 size={14} className="faint" />
              <span style={{ fontWeight: 500 }}>{r.route}</span>
              <span className="faint" style={{ marginLeft: "auto", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 220 }}>
                {r.dynamic ? "dynamic route" : r.file}
              </span>
            </button>
          ))}
        </div>
        <div className="modal-actions">
          <button className="btn outline" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function PageRow({ page }: { page: { name: string; frames: number } }) {
  const current = useStore((s) => s.canvas === page.name);
  const agentHere = useStore((s) => Object.values(s.presence).some((p) => p.canvas === page.name && Date.now() - p.at < 12_000));
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const s = useStore.getState;

  const rename = async (v: string) => {
    setRenaming(false);
    const to = slug(v);
    if (!to || to === page.name) return;
    try {
      await api.renameCanvas(page.name, to);
    } catch (err) {
      s().toast((err as Error).message);
    }
  };
  const duplicate = async () => {
    try {
      const { name } = await api.duplicateCanvas(page.name);
      useStore.setState({ canvas: name });
    } catch (err) {
      s().toast((err as Error).message);
    }
  };
  const remove = async () => {
    setConfirming(false);
    try {
      await api.deleteCanvas(page.name);
      s().toast(`Deleted ${page.name}`, "info", {
        label: "Undo",
        run: () => void api.restoreCanvas(page.name).then(({ name }) => useStore.setState({ canvas: name })),
      });
    } catch (err) {
      s().toast((err as Error).message);
    }
  };

  if (renaming) return <InlineName initial={page.name} onDone={rename} />;
  return (
    <>
      <div
        className={`page-row${current ? " current" : ""}`}
        role="button"
        tabIndex={0}
        onClick={() => !current && useStore.setState({ canvas: page.name })}
        onDoubleClick={() => setRenaming(true)}
        onKeyDown={(e) => e.key === "Enter" && useStore.setState({ canvas: page.name })}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        <span className="check">{current && <Check size={13} />}</span>
        <span className="name">{page.name}</span>
        {agentHere && <span className="flash-dot" title="An agent is working here" />}
        <span className="count">{page.frames}</span>
        <button
          className="icon-btn sm more"
          aria-label={`Page options for ${page.name}`}
          onClick={(e) => {
            e.stopPropagation();
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      </div>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(true) },
            { label: "Duplicate", icon: <CopyPlus size={14} />, onSelect: () => void duplicate() },
            { label: "Open file in editor", icon: <FileCode2 size={14} />, onSelect: () => void api.openFile(`${useStore.getState().doc?.file.split("/").slice(0, -1).join("/") || "canvas"}/${page.name}.canvas.tsx`) },
            "sep",
            { label: "Delete page", icon: <Trash2 size={14} />, danger: true, onSelect: () => setConfirming(true) },
          ]}
        />
      )}
      {confirming && (
        <Confirm
          title={`Delete “${page.name}”?`}
          body={`This removes ${page.name}.canvas.tsx from your project. You can undo it right after.`}
          confirm="Delete page"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void remove()}
        />
      )}
    </>
  );
}

function InlineName({ initial, placeholder, onDone }: { initial: string; placeholder?: string; onDone: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  const done = useRef(false);
  const finish = (v: string) => {
    if (done.current) return;
    done.current = true;
    onDone(v);
  };
  return (
    <div className="inline-name">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => finish(value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") finish(value);
          if (e.key === "Escape") finish(initial);
        }}
      />
    </div>
  );
}

export function Confirm({ title, body, confirm, onConfirm, onCancel }: { title: string; body: string; confirm: string; onConfirm: () => void; onCancel: () => void }) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") onCancel();
      if (e.key === "Enter") onConfirm();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCancel, onConfirm]);
  return createPortal(
    <div className="modal-backdrop" onPointerDown={onCancel}>
      <div className="modal" role="alertdialog" aria-labelledby="confirm-title" onPointerDown={(e) => e.stopPropagation()}>
        <div id="confirm-title" className="modal-title">
          {title}
        </div>
        <p className="muted">{body}</p>
        <div className="modal-actions">
          <button className="btn outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger-solid" autoFocus onClick={onConfirm}>
            {confirm}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ---------- Layers ----------

type DropPos = { id: string; where: "before" | "after" | "inside" } | null;

function Layers() {
  const doc = useStore((s) => s.doc);
  const query = useStore((s) => s.layerQuery);
  const matches = useLayerMatches();
  const [dropPos, setDropPos] = useState<DropPos>(null);
  const dragId = useRef<string | null>(null);
  if (!doc) return <div className="empty">Loading…</div>;
  if (doc.error) return <div className="empty">The canvas file has a syntax error:<br />{doc.error}</div>;
  if (!doc.frames.length) return <div className="empty">No frames yet.<br />Press F and drag on the canvas.</div>;

  const onDrop = async () => {
    const s = useStore.getState();
    const from = dragId.current;
    const target = dropPos;
    dragId.current = null;
    setDropPos(null);
    if (!from || !target || from === target.id) return;
    const t = s.index.get(target.id);
    if (!t) return;
    if (target.where === "inside") await s.run({ op: "move", canvas: s.canvas!, id: from, parent: target.id });
    else if (t.parent) {
      const siblings = t.parent.children.filter((c) => c.id !== from);
      const i = siblings.findIndex((c) => c.id === target.id) + (target.where === "after" ? 1 : 0);
      await s.run({ op: "move", canvas: s.canvas!, id: from, parent: t.parent.id, index: i });
    }
  };

  return (
    <>
      <LayerSearch />
      <div className="scroll tree" role="tree" onDragEnd={() => setDropPos(null)}>
        {doc.frames.map((f) => (
          <LayerRow key={f.id} node={f} depth={0} isFrame dragId={dragId} dropPos={dropPos} setDropPos={setDropPos} onDrop={onDrop} />
        ))}
        {matches && matches.size === 0 && <div className="empty">No layers match “{query}”.</div>}
      </div>
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

const LayerRow = memo(function LayerRow({
  node,
  depth,
  isFrame,
  dragId,
  dropPos,
  setDropPos,
  onDrop,
}: {
  node: CanvasNode;
  depth: number;
  isFrame?: boolean;
  dragId: React.MutableRefObject<string | null>;
  dropPos: DropPos;
  setDropPos: (d: DropPos) => void;
  onDrop: () => void;
}) {
  const selected = useStore((s) => s.selection.includes(node.id));
  const hovered = useStore((s) => s.hover === node.id);
  const matches = useLayerMatches();
  const searching = matches !== null;
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
  if (dropPos?.id === node.id) cls.push(`drop-${dropPos.where}`);
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
          dragId.current = node.id;
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", node.id);
        }}
        onDragOver={(e) => {
          if (!dragId.current || dragId.current === node.id) return;
          e.preventDefault();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          const y = (e.clientY - r.top) / r.height;
          const container = isFrame || acceptsChildren(node);
          const where = isFrame ? "inside" : container && y > 0.3 && y < 0.7 ? "inside" : y < 0.5 ? "before" : "after";
          if (dropPos?.id !== node.id || dropPos.where !== where) setDropPos({ id: node.id, where });
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop();
        }}
      >
        <span className={`twisty${open ? " open" : ""}`} onClick={hasKids ? toggle : undefined} style={{ visibility: hasKids ? "visible" : "hidden" }}>
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
        kids.map((c) => <LayerRow key={c.id} node={c} depth={depth + 1} dragId={dragId} dropPos={dropPos} setDropPos={setDropPos} onDrop={onDrop} />)}
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

// ---------- Components ----------

/** HTML building blocks: click to insert next to (or into) the selection. */
function BasicsGrid({ q }: { q: string }) {
  const shown = ELEMENTS.filter((el) => !q || el.label.toLowerCase().includes(q.toLowerCase()));
  if (!shown.length) return null;
  return (
    <>
      <div className="group-title">Basics</div>
      <div className="basics-grid">
        {shown.map((el) => (
          <button key={el.key} className="basic" title={`Insert ${el.label.toLowerCase()}${el.kbd ? ` (${el.kbd})` : ""}`} onClick={() => void insertElement(el)}>
            {ELEMENT_ICONS[el.key]}
            <span>{el.label}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function ComponentsList() {
  const components = useStore((s) => s.components);
  const componentsDir = useStore((s) => s.componentsDir);
  const [q, setQ] = useState("");
  const [openPresets, setOpenPresets] = useState<string | null>(null);
  const groups = useMemo(() => {
    const filtered = components.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || c.file.toLowerCase().includes(q.toLowerCase()));
    const map = new Map<string, ComponentSpec[]>();
    for (const c of filtered) {
      const dir = c.library ? libraryLabel(c.library) : c.file.split("/").slice(0, -1).join("/") || ".";
      map.set(dir, [...(map.get(dir) ?? []), c]);
    }
    return [...map];
  }, [components, q]);

  return (
    <>
      <div className="search">
        <div className="field">
          <span className="prefix">
            <Search size={13} />
          </span>
          <input value={q} placeholder="Search assets" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
        </div>
      </div>
      <div className="scroll" style={{ paddingBottom: 24 }}>
        <BasicsGrid q={q} />
        <div className="group-title with-action">
          <span>Components</span>
          <button className="icon-btn sm" aria-label="New component" title="New component" onClick={() => openComponentDialog(false)}>
            <Plus size={13} />
          </button>
        </div>
        {!components.length && (
          <div className="assets-empty">
            <Component size={18} />
            <div className="title">No components yet</div>
            <div className="faint">
              Components are <span className="mono">.tsx</span> files in <span className="mono">{componentsDir}/</span>. Make one here, or select layers and press <span className="kbd-chip">{kbd.mod}⌥K</span> to turn them into a component.
            </div>
            <button className="btn outline small" onClick={() => openComponentDialog(false)}>
              <Plus size={13} /> New component
            </button>
          </div>
        )}
        {groups.map(([dir, list]) => (
          <div key={dir}>
            <div className="group-title">{dir}</div>
            <div className="asset-grid">
              {list.map((c) => (
                <AssetCard key={c.name} spec={c} expanded={openPresets === c.name} onTogglePresets={() => setOpenPresets(openPresets === c.name ? null : c.name)} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

/** Preset values that differ from the defaults, so inserted code stays short. */
function presetProps(spec: ComponentSpec, preset: string): Record<string, Literal> {
  const p = spec.presets?.find((x) => x.name === preset);
  if (!p) return {};
  const out: Record<string, Literal> = {};
  for (const [k, v] of Object.entries(p.props)) {
    const def = spec.props.find((x) => x.name === k)?.default;
    if (JSON.stringify(def) !== JSON.stringify(v)) out[k] = v as Literal;
  }
  return out;
}

function Thumb({ spec, preset }: { spec: ComponentSpec; preset?: string }) {
  const [state, setState] = useState<"loading" | "ok" | "error">("loading");
  const src = `/api/thumb?component=${encodeURIComponent(spec.name)}${preset ? `&preset=${encodeURIComponent(preset)}` : ""}`;
  return (
    <span className={`thumb ${state}`}>
      {state === "error" ? (
        spec.library ? <Waves size={16} /> : <Component size={16} />
      ) : (
        <img src={src} alt="" loading="lazy" draggable={false} onLoad={() => setState("ok")} onError={() => setState("error")} />
      )}
    </span>
  );
}

function AssetCard({ spec, expanded, onTogglePresets }: { spec: ComponentSpec; expanded: boolean; onTogglePresets: () => void }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const drag = (props?: Record<string, Literal>) => (e: React.DragEvent) => {
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("application/x-truecanvas-component", JSON.stringify({ ...spec, insertProps: props }));
  };
  const presets = spec.presets ?? [];
  return (
    <>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Insert", icon: <Plus size={14} />, onSelect: () => void insertComponent(spec) },
            ...(!spec.library ? [{ label: "Edit main component", icon: <Pencil size={14} />, onSelect: () => void editComponent(spec.name) }] : []),
            { label: "Open in code editor", icon: <FileCode2 size={14} />, onSelect: () => goToComponent(spec.name) },
          ]}
        />
      )}
      <div
        className="asset"
        draggable
        onDragStart={drag()}
        onClick={() => void insertComponent(spec)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
        title={spec.description ?? (spec.library ? "Drag onto the canvas, or click to insert" : "Click to insert · right-click to edit its main component")}
      >
        <Thumb spec={spec} />
        <span className="asset-name">
          <span>{spec.name}</span>
          {presets.length > 0 && (
            <button
              className={`asset-presets${expanded ? " on" : ""}`}
              aria-label={`${presets.length} presets`}
              onClick={(e) => {
                e.stopPropagation();
                onTogglePresets();
              }}
            >
              {presets.length}
              <ChevronRight size={11} />
            </button>
          )}
        </span>
      </div>
      {expanded && (
        <div className="preset-strip">
          {presets.map((p) => (
            <div key={p.name} className="asset small" draggable onDragStart={drag(presetProps(spec, p.name))} onClick={() => void insertComponent(spec, undefined, presetProps(spec, p.name))}>
              <Thumb spec={spec} preset={p.name} />
              <span className="asset-name">
                <span>{p.name}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function libraryLabel(lib: string) {
  if (lib === "@paper-design/shaders-react") return "Paper Shaders";
  return lib;
}
