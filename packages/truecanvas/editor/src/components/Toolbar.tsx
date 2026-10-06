import { useState } from "react";
import { Component, Frame, Hand, Heading1, Heading2, Heading3, Image, LayoutGrid, Link, List, MessageCircle, Minus, Monitor, Moon, MousePointer2, Pause, Play, Plus, Pointer, RectangleHorizontal, Rows3, Columns3, Square, Sun, TextCursorInput, Type, PanelTop, Smile, Blocks } from "lucide-react";
import { useStore, persist, type ThemeMode, type Tool } from "../lib/store";
import { zoomBy, zoomTo, zoomToFit, zoomToSelection } from "../lib/actions";
import { Tip } from "./controls";
import { Menu, type MenuItem } from "./Menu";
import { ELEMENTS, insertElement } from "../lib/elements";
import { openComponentDialog } from "./ComponentDialog";
import { openLibraries } from "./LibrariesDialog";

export const ELEMENT_ICONS: Record<string, React.ReactNode> = {
  text: <Type size={14} />,
  h1: <Heading1 size={14} />,
  h2: <Heading2 size={14} />,
  h3: <Heading3 size={14} />,
  link: <Link size={14} />,
  button: <RectangleHorizontal size={14} />,
  list: <List size={14} />,
  stack: <Rows3 size={14} />,
  row: <Columns3 size={14} />,
  grid: <LayoutGrid size={14} />,
  box: <Square size={14} />,
  section: <PanelTop size={14} />,
  divider: <Minus size={14} />,
  image: <Image size={14} />,
  input: <TextCursorInput size={14} />,
};

/** The Insert menu: HTML elements by group, then components. */
export function insertMenuItems(): (MenuItem | "sep")[] {
  const items: (MenuItem | "sep")[] = [];
  let group = "";
  for (const el of ELEMENTS) {
    if (group && el.group !== group) items.push("sep");
    group = el.group;
    items.push({ label: el.label, icon: ELEMENT_ICONS[el.key], kbd: el.kbd, onSelect: () => void insertElement(el) });
  }
  items.push("sep");
  items.push({ label: "Icon…", icon: <Smile size={14} />, onSelect: () => openLibraries("icons") });
  items.push({ label: "Component…", icon: <Component size={14} />, onSelect: () => useStore.setState({ leftTab: "components" }) });
  items.push({ label: "shadcn/ui component…", icon: <Blocks size={14} />, onSelect: () => openLibraries("shadcn") });
  items.push({ label: "New component…", icon: <Plus size={14} />, onSelect: () => openComponentDialog(false) });
  return items;
}

const TOOLS: { tool: Tool; label: string; kbd: string; icon: React.ReactNode }[] = [
  { tool: "select", label: "Select", kbd: "V", icon: <MousePointer2 size={16} /> },
  { tool: "frame", label: "Frame", kbd: "F", icon: <Frame size={16} /> },
  { tool: "hand", label: "Hand", kbd: "H", icon: <Hand size={16} /> },
  { tool: "interact", label: "Interact with the app", kbd: "P", icon: <Pointer size={16} /> },
  { tool: "comment", label: "Comment", kbd: "C", icon: <MessageCircle size={16} /> },
];

const NEXT_THEME: Record<ThemeMode, ThemeMode> = { system: "light", light: "dark", dark: "system" };

export function Toolbar() {
  const tool = useStore((s) => s.tool);
  const zoom = useStore((s) => s.camera.zoom);
  const theme = useStore((s) => s.canvasTheme);
  const paused = useStore((s) => s.motionPaused);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [insert, setInsert] = useState<{ x: number; y: number } | null>(null);
  const themeIcon = theme === "system" ? <Monitor size={16} /> : theme === "light" ? <Sun size={16} /> : <Moon size={16} />;
  return (
    <div className="toolbar" onPointerDown={(e) => e.stopPropagation()}>
      {TOOLS.map((t) => (
        <Tip key={t.tool} label={t.label} kbd={t.kbd}>
          <button className={`icon-btn${tool === t.tool ? " on" : ""}`} aria-label={t.label} aria-pressed={tool === t.tool} onClick={() => useStore.setState({ tool: t.tool, hover: null, ...(t.tool === "comment" ? { rightTab: "comments" as const } : {}) })}>
            {t.icon}
          </button>
        </Tip>
      ))}
      <Tip label="Insert" kbd="T text">
        <button
          className={`icon-btn${insert ? " on" : ""}`}
          aria-label="Insert"
          onClick={(e) => {
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
            setInsert({ x: r.left - 8, y: r.top - 8 });
          }}
        >
          <Plus size={17} />
        </button>
      </Tip>
      {insert && <Menu x={insert.x} y={insert.y} anchor="above" items={insertMenuItems()} onClose={() => setInsert(null)} />}
      <span className="sep" />
      <Tip label={`Canvas theme: ${theme}`}>
        <button
          className="icon-btn"
          aria-label={`Canvas theme: ${theme}`}
          onClick={() => {
            const next = NEXT_THEME[theme];
            useStore.setState({ canvasTheme: next });
            persist("tc:canvasTheme", next);
          }}
        >
          {themeIcon}
        </button>
      </Tip>
      <Tip label={paused ? "Play animations" : "Pause animations"} kbd="⇧P">
        <button
          className={`icon-btn${paused ? " on" : ""}`}
          aria-label={paused ? "Play animations" : "Pause animations"}
          aria-pressed={paused}
          onClick={toggleMotion}
        >
          {paused ? <Play size={15} /> : <Pause size={15} />}
        </button>
      </Tip>
      <span className="sep" />
      <button
        className="btn zoom"
        onClick={(e) => {
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setMenu({ x: r.left - 60, y: r.top - 196 });
        }}
      >
        {Math.round(zoom * 100)}%
      </button>
      {menu && (
        <Menu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: "Zoom in", kbd: "⌘+", onSelect: () => zoomBy(1.25) },
            { label: "Zoom out", kbd: "⌘−", onSelect: () => zoomBy(0.8) },
            "sep",
            { label: "Zoom to fit", kbd: "⇧1", onSelect: zoomToFit },
            { label: "Zoom to selection", kbd: "⇧2", onSelect: zoomToSelection },
            { label: "Zoom to 100%", kbd: "⇧0", onSelect: () => zoomTo(1) },
          ]}
        />
      )}
    </div>
  );
}

export function toggleMotion() {
  const next = !useStore.getState().motionPaused;
  useStore.setState({ motionPaused: next });
  persist("tc:motionPaused", next);
}
