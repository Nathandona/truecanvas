/* The Pages list: one page per canvas file, and adding pages from the app's routes. */
import { Dialog } from "./Dialog";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronRight, CopyPlus, FileCode2, FlaskConical, Link2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Tip } from "./controls";
import { useStore } from "../lib/store";
import { api } from "../lib/api";
import { Menu } from "./Menu";

const slug = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

export function Pages() {
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
  return (
    <Dialog title="Add a page from your app" width={460} onClose={onClose}>
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
    </Dialog>
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
        onDoubleClick={() => setRenaming(true)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* one button to open the page, next to (not around) the options button */}
        <button className="page-open" aria-current={current ? "page" : undefined} onClick={() => !current && useStore.setState({ canvas: page.name })}>
          <span className="check">{current && <Check size={13} />}</span>
          <span className="name">{page.name}</span>
          {agentHere && <span className="flash-dot" title="An agent is working here" />}
          <span className="count">{page.frames}</span>
        </button>
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
  // Enter activates the focused button (Confirm by default, Cancel once tabbed to)
  return (
    <Dialog title={title} width={360} role="alertdialog" onClose={onCancel}>
        <p className="muted">{body}</p>
        <div className="modal-actions">
          <button className="btn outline" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn danger-solid" autoFocus onClick={onConfirm}>
            {confirm}
          </button>
        </div>
    </Dialog>
  );
}
