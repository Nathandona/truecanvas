/* Assets: HTML basics, the project's components with live thumbnails, and libraries. */
import { ELEMENTS, editComponent, insertElement } from "../lib/elements";
import { ELEMENT_ICONS } from "./Toolbar";
import { openComponentDialog } from "./ComponentDialog";
import { openLibraries } from "./LibrariesDialog";
import { useMemo, useState } from "react";
import { ChevronRight, Component, FileCode2, Pencil, Plus, Search, Waves, Smile, Blocks } from "lucide-react";
import { useStore } from "../lib/store";
import { insertComponent, kbd } from "../lib/actions";
import { goToComponent } from "./CanvasMenu";
import { type ComponentSpec, type Literal } from "../lib/api";
import { Menu } from "./Menu";

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

export function ComponentsList() {
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
            <div className="assets-empty-actions">
              <button className="btn outline small" onClick={() => openComponentDialog(false)}>
                <Plus size={13} /> New component
              </button>
              <button className="btn outline small" onClick={() => openLibraries("shadcn")}>
                <Blocks size={13} /> Add shadcn/ui
              </button>
            </div>
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
        <div className="group-title">Libraries</div>
        <button className="library-link" onClick={() => openLibraries("icons")}>
          <Smile size={14} />
          <span>
            Icons
            <span className="faint">Lucide, Tabler, Phosphor, Heroicons, Radix</span>
          </span>
        </button>
        <button className="library-link" onClick={() => openLibraries("shadcn")}>
          <Blocks size={14} />
          <span>
            shadcn/ui
            <span className="faint">Buttons, dialogs, forms… copied into your project</span>
          </span>
        </button>
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
        role="button"
        tabIndex={0}
        aria-label={`Insert ${spec.name}`}
        draggable
        onDragStart={drag()}
        onClick={() => void insertComponent(spec)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || (e.key !== "Enter" && e.key !== " ")) return;
          e.preventDefault();
          void insertComponent(spec);
        }}
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
