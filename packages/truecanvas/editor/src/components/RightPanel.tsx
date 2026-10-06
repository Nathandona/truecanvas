import { useEffect, useState } from "react";
import { ArrowRight, Bot, Code2, Component, CopyPlus, ExternalLink, FileCode2, Frame as FrameIcon, LayoutList, Monitor, Moon, RotateCcw, Sun, Trash2, RectangleVertical, RefreshCcw, Smartphone, Tablet, Laptop, Waves } from "lucide-react";
import { useStore, layerName, persist, type ThemeMode } from "../lib/store";
import { api, DEVICES, type CanvasFrame, type CanvasNode, type ComponentSpec, type Literal, type PropSpec, type PropValue } from "../lib/api";
import { applyUiTheme, copySelectionCode, deleteSelection, duplicateSelection, openInEditor, wrapSelection, zoomToSelection } from "../lib/actions";

import { ColorField, ColorList, CopyButton, NumberField, Section, Segmented, Select, SliderField, Switch, TextField, Tip } from "./controls";
import { SHORTCUTS } from "./shortcuts";
import { goToComponent } from "./CanvasMenu";
import { MotionSection } from "./MotionSection";
import { rawId } from "../lib/scope";
import { StyleSections } from "./StyleSections";
import { CommentsTab } from "./Comments";
import { AgentTab } from "./AgentTab";

export function RightPanel() {
  const tab = useStore((s) => s.rightTab);
  const agents = useStore((s) => s.agents);
  const unseen = useUnseenAgentChanges();
  const openComments = useStore((s) => s.threads.filter((t) => !t.resolved).length);
  return (
    <aside className="panel right">
      <div className="panel-head" style={{ paddingLeft: 10 }}>
        <div className="tabs" role="tablist" style={{ flex: 1 }}>
          <button role="tab" aria-selected={tab === "design"} className={`tab${tab === "design" ? " on" : ""}`} onClick={() => useStore.setState({ rightTab: "design" })}>
            Design
          </button>
          <button role="tab" aria-selected={tab === "comments"} className={`tab${tab === "comments" ? " on" : ""}`} onClick={() => useStore.setState({ rightTab: "comments" })}>
            Comments
            {openComments > 0 && <span className="count neutral">{openComments}</span>}
          </button>
          <button role="tab" aria-selected={tab === "agent"} className={`tab${tab === "agent" ? " on" : ""}`} onClick={() => useStore.setState({ rightTab: "agent" })}>
            {agents.length ? <span className="live-dot" /> : <Bot size={13} />}
            Agent
            {unseen > 0 && tab !== "agent" && <span className="count">{unseen}</span>}
          </button>
        </div>
      </div>
      <div className="scroll">{tab === "design" ? <Design /> : tab === "comments" ? <CommentsTab /> : <AgentTab />}</div>
    </aside>
  );
}

/** Agent changes since the Agent tab was last open. By id: the feed is capped, so counting its length stalls. */
function useUnseenAgentChanges() {
  const feed = useStore((s) => s.feed);
  const tab = useStore((s) => s.rightTab);
  const [seenId, setSeenId] = useState(0);
  const latest = feed.length ? feed[feed.length - 1].id : 0;
  useEffect(() => {
    if (tab === "agent") setSeenId(latest);
  }, [tab, latest]);
  return feed.filter((f) => f.actor.kind === "agent" && f.id > seenId).length;
}

// =====================================================================
// Design
// =====================================================================

function FramePresets() {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const groups: [string, React.ReactNode, typeof DEVICES][] = [
    ["Phone", <Smartphone size={13} key="p" />, DEVICES.filter((d) => d.kind === "phone")],
    ["Tablet", <Tablet size={13} key="t" />, DEVICES.filter((d) => d.kind === "tablet")],
    ["Desktop", <Laptop size={13} key="d" />, DEVICES.filter((d) => d.kind === "desktop")],
  ];
  return (
    <Section title="Frame presets">
      <p className="faint" style={{ margin: "-4px 0 10px" }}>Drag on the canvas for a custom size, or pick a device.</p>
      {groups.map(([title, icon, list]) => (
        <div key={title} style={{ marginBottom: 10 }}>
          <div className="muted" style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 2 }}>
            {icon} {title}
          </div>
          {list.map((d) => (
            <button
              key={d.id}
              className="btn preset-row"
              onClick={async () => {
                await run({ op: "create_frame", canvas, device: d.id });
                useStore.setState({ tool: "select" });
              }}
            >
              <span>{d.name}</span>
              <span className="faint">
                {d.width}×{d.height}
              </span>
            </button>
          ))}
        </div>
      ))}
    </Section>
  );
}

function Design() {
  const tool = useStore((s) => s.tool);
  const selection = useStore((s) => s.selection);
  const index = useStore((s) => s.index);
  const entries = selection.map((id) => index.get(id)).filter(Boolean);
  if (tool === "frame") return <FramePresets />;
  if (!entries.length) return <CanvasSettings />;
  if (entries.length > 1) return <MultiSelection count={entries.length} />;
  const e = entries[0]!;
  if (e.node.id === e.frame.id) return <FrameInspector frame={e.frame} />;
  return <NodeInspector key={e.node.id} node={e.node} />;
}

const themeOptions = (inherit: boolean) => [
  inherit ? { value: "inherit" as const, label: "Inherit" } : { value: "system" as const, icon: <Monitor size={13} />, label: "System" },
  { value: "light" as const, icon: <Sun size={13} />, title: "Light", label: inherit ? undefined : "Light" },
  { value: "dark" as const, icon: <Moon size={13} />, title: "Dark", label: inherit ? undefined : "Dark" },
];

function CanvasSettings() {
  const canvasTheme = useStore((s) => s.canvasTheme);
  const uiTheme = useStore((s) => s.uiTheme);
  const deviceChrome = useStore((s) => s.deviceChrome);
  const doc = useStore((s) => s.doc);
  return (
    <>
      <Section title="Canvas">
        <div className="muted" style={{ marginBottom: 6 }}>Frame theme</div>
        <div>
          <div>
            <Segmented<ThemeMode>
              value={canvasTheme}
              options={themeOptions(false) as { value: ThemeMode; label?: string; icon?: React.ReactNode }[]}
              onChange={(v) => {
                useStore.setState({ canvasTheme: v });
                persist("tc:canvasTheme", v);
              }}
            />
          </div>
        </div>
        <div className="muted" style={{ margin: "12px 0 6px" }}>Interface</div>
        <div>
          <div>
            <Segmented<ThemeMode>
              value={uiTheme}
              options={themeOptions(false) as { value: ThemeMode; label?: string; icon?: React.ReactNode }[]}
              onChange={(v) => {
                useStore.setState({ uiTheme: v });
                persist("tc:uiTheme", v);
                applyUiTheme();
              }}
            />
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: "space-between" }}>
          <span className="muted">Device chrome on mobile frames</span>
          <Switch
            on={deviceChrome}
            onChange={(v) => {
              useStore.setState({ deviceChrome: v });
              persist("tc:deviceChrome", v);
            }}
            ariaLabel="Device chrome"
          />
        </div>
        {doc && (
          <div className="row muted" style={{ marginTop: 10, justifyContent: "space-between" }}>
            <button className="link" onClick={() => openInEditor()}>
              <FileCode2 size={13} />
              <span>{doc.file}</span>
            </button>
            <span className="faint">
              {doc.frames.length} {doc.frames.length === 1 ? "frame" : "frames"}
            </span>
          </div>
        )}
      </Section>
      <Section title="Shortcuts">
        <div className="shortcut-list">
          {SHORTCUTS.map(([label, key]) => (
            <div key={label}>
              <span>{label}</span>
              <span className="kbd">{key}</span>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}

function MultiSelection({ count }: { count: number }) {
  return (
    <Section title={`${count} layers`}>
      <div className="grid2">
        <button className="btn outline" onClick={wrapSelection}>
          <LayoutList size={14} /> Auto layout
        </button>
        <button className="btn outline" onClick={duplicateSelection}>
          <CopyPlus size={14} /> Duplicate
        </button>
      </div>
      <div className="grid2">
        <button className="btn outline" onClick={() => void copySelectionCode()}>
          <Code2 size={14} /> Copy JSX
        </button>
        <button className="btn danger outline" onClick={deleteSelection}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </Section>
  );
}

// ---------- Frame ----------

function FrameInspector({ frame }: { frame: CanvasFrame }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const measured = useStore((s) => s.frameHeights[frame.frameName]);
  const update = (patch: Record<string, unknown>) => run({ op: "update_frame", canvas, frame: frame.frameName, ...patch });
  return (
    <>
      <Section
        title={
          <span className="node-head">
            <FrameIcon size={14} className="faint" />
            <span className="title">Frame</span>
          </span>
        }
        actions={
          <Tip label="Zoom to frame" kbd="⇧2">
            <button className="icon-btn sm" aria-label="Zoom to frame" onClick={zoomToSelection}>
              <ArrowRight size={13} style={{ transform: "rotate(-45deg)" }} />
            </button>
          </Tip>
        }
      >
        <TextField value={frame.frameName} onCommit={(v) => v.trim() && update({ name: v.trim() })} ariaLabel="Frame name" />
        <div className="grid2" style={{ marginTop: 6, gridTemplateColumns: "1fr auto" }}>
          <Select
            value={frame.device ?? ""}
            placeholder="Custom size"
            options={[
              { value: "", label: "Custom size", icon: <RectangleVertical size={13} /> },
              ...(["phone", "tablet", "desktop"] as const).flatMap((kind) => [
                { value: `h-${kind}`, label: kind === "phone" ? "Phones" : kind === "tablet" ? "Tablets" : "Desktop", heading: true },
                ...DEVICES.filter((d) => d.kind === kind).map((d) => ({
                  value: d.id,
                  label: d.name,
                  hint: `${d.width}×${d.height}`,
                  icon: kind === "phone" ? <Smartphone size={13} /> : kind === "tablet" ? <Tablet size={13} /> : <Laptop size={13} />,
                })),
              ]),
            ]}
            onChange={(v) => update({ device: v || null })}
            ariaLabel="Device"
          />
          <Tip label="Rotate">
            <button
              className="icon-btn"
              aria-label="Rotate frame"
              onClick={() => update({ width: frame.height ?? measured ?? frame.width, height: frame.width })}
            >
              <RefreshCcw size={14} />
            </button>
          </Tip>
        </div>
        <div className="grid2" style={{ marginTop: 6 }}>
          <NumberField prefix="X" value={frame.x} onCommit={(v) => v !== null && update({ x: v })} ariaLabel="X" />
          <NumberField prefix="Y" value={frame.y} onCommit={(v) => v !== null && update({ y: v })} ariaLabel="Y" />
        </div>
        <div className="grid2">
          <NumberField prefix="W" value={frame.width} min={120} onCommit={(v) => v !== null && update({ width: v })} ariaLabel="Width" />
          <NumberField
            prefix="H"
            value={frame.height}
            placeholder={measured ? String(measured) : "Hug"}
            min={80}
            onCommit={(v) => update({ height: v })}
            ariaLabel="Height"
          />
        </div>
        <div style={{ marginTop: 6 }}>
          <Segmented
            value={frame.height === null ? "hug" : "fixed"}
            options={[
              { value: "fixed", label: "Fixed height" },
              { value: "hug", label: "Hug contents" },
            ]}
            onChange={(v) => update({ height: v === "hug" ? null : (measured ?? 720) })}
          />
        </div>
      </Section>
      <Section title="Theme">
        <Segmented
          value={frame.theme ?? "inherit"}
          options={themeOptions(true) as { value: "inherit" | "light" | "dark"; label?: string; icon?: React.ReactNode; title?: string }[]}
          onChange={(v) => update({ theme: v === "inherit" ? null : v })}
        />
        <p className="faint" style={{ margin: "8px 0 0" }}>
          {frame.theme ? `Always rendered ${frame.theme}.` : "Follows the canvas theme."}
        </p>
      </Section>
      <BackgroundSection parentId={frame.id} />
      <CodeSection id={frame.id} />
    </>
  );
}

// ---------- Node ----------

function NodeInspector({ node }: { node: CanvasNode }) {
  const components = useStore((s) => s.components);
  const spec = node.kind === "component" ? components.find((c) => c.name === node.name) : undefined;
  const className = node.props.className;
  const showLayout = node.kind === "element" || !!spec?.acceptsClassName || className !== undefined;
  const isComponent = node.kind === "component";
  const textOnly = node.children.length > 0 && node.children.every((c) => c.kind === "text");
  return (
    <>
      <Section
        title={
          <span className="node-head">
            {node.kind === "component" ? <Component size={14} style={{ color: "var(--component)" }} /> : <span className="chip mono">{`<${node.name}>`}</span>}
            {node.kind === "component" && <span className="title" style={{ color: "var(--component)" }}>{layerName(node)}</span>}
          </span>
        }
        actions={
          <>
            <Tip label="Open in editor">
              <button className="icon-btn sm" onClick={() => openInEditor(node.id)} aria-label="Open in editor">
                <ExternalLink size={13} />
              </button>
            </Tip>
          </>
        }
      >
        {spec ? (
          <>
            {spec.description && <p className="muted" style={{ margin: "-4px 0 8px" }}>{spec.description}</p>}
            <button className="link" onClick={() => goToComponent(spec.name)}>
              <FileCode2 size={13} />
              <span>{spec.file}</span>
            </button>
          </>
        ) : node.kind === "component" ? (
          <p className="faint" style={{ margin: 0 }}>Not in the component catalog. Props are shown as written.</p>
        ) : null}
      </Section>
      {node.kind === "component" && <PropsSection node={node} spec={spec} />}
      {node.kind === "element" && <AttributesSection node={node} />}
      {(textOnly || (spec?.acceptsChildren && node.children.length === 0)) && <ContentSection node={node} />}
      <MotionSection node={node} />
      {showLayout && <StyleSections node={node} component={isComponent} />}
      {node.kind === "element" && <BackgroundSection parentId={node.id} />}
      <CodeSection id={node.id} />
    </>
  );
}

function literalOf(v: PropValue | undefined): Literal | undefined {
  if (!v) return undefined;
  return v.kind === "expression" ? undefined : v.value;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function PropsSection({ node, spec }: { node: CanvasNode; spec?: ComponentSpec }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const set = (name: string, value: Literal) => run({ op: "set_props", canvas, id: node.id, props: { [name]: value } }, { select: false });
  const specs = (spec?.props ?? []).filter((p) => p.name !== "className" && p.name !== "children");
  const extra = Object.keys(node.props).filter((k) => k !== "className" && k !== "children" && k !== "data-name" && !specs.some((p) => p.name === k));
  if (!specs.length && !extra.length) return null;
  const presets = spec?.presets ?? [];
  const activePreset = presets.find((p) => Object.entries(p.props).every(([k, v]) => same(literalOf(node.props[k]) ?? specs.find((x) => x.name === k)?.default, v)));
  return (
    <Section title="Props">
      {presets.length > 0 && (
        <div className="prop" style={{ marginBottom: 6 }}>
          <label>Preset</label>
          <Select
            value={activePreset?.name ?? ""}
            placeholder="Custom"
            options={presets.map((p) => ({ value: p.name, label: p.name }))}
            onChange={(name) => name && run({ op: "apply_preset", canvas, id: node.id, preset: name }, { select: false })}
            ariaLabel="Preset"
          />
          <span style={{ width: 22 }} />
        </div>
      )}
      {specs
        .filter((p) => !p.advanced)
        .map((p) => (
          <PropControl key={p.name} spec={p} value={node.props[p.name]} onChange={(v) => set(p.name, v)} />
        ))}
      {specs.some((p) => p.advanced) && (
        <details className="advanced" open={specs.some((p) => p.advanced && node.props[p.name] !== undefined)}>
          <summary>Advanced</summary>
          {specs
            .filter((p) => p.advanced)
            .map((p) => (
              <PropControl key={p.name} spec={p} value={node.props[p.name]} onChange={(v) => set(p.name, v)} />
            ))}
        </details>
      )}
      {extra.map((k) => (
        <PropControl key={k} spec={{ name: k, type: inferType(node.props[k]), optional: true, typeText: "" }} value={node.props[k]} onChange={(v) => set(k, v)} />
      ))}
      {node.spreads > 0 && <p className="faint" style={{ margin: "8px 0 0" }}>Has spread props, so some values come from code.</p>}
    </Section>
  );
}

function inferType(v: PropValue | undefined): PropSpec["type"] {
  if (!v) return "string";
  if (v.kind === "array") return v.value.every((x) => typeof x === "string" && /^#|^rgb|^hsl|^oklch/.test(x)) ? "colors" : "other";
  if (v.kind === "boolean") return "boolean";
  if (v.kind === "number") return "number";
  if (v.kind === "string") return "string";
  return "other";
}

const pretty = (s: string) => s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

function PropControl({ spec, value, onChange }: { spec: PropSpec; value: PropValue | undefined; onChange: (v: Literal) => void }) {
  const isSet = value !== undefined;
  const lit = literalOf(value);
  const label = pretty(spec.name);
  const reset = isSet ? (
    <Tip label="Reset to default">
      <button className="icon-btn sm reset" onClick={() => onChange(null)} aria-label={`Reset ${spec.name}`}>
        <RotateCcw size={12} />
      </button>
    </Tip>
  ) : (
    <span style={{ width: 22 }} />
  );

  let control: React.ReactNode;
  if (value?.kind === "expression") {
    control = (
      <Tip label={value.code}>
        <div className="field readonly">{`{${value.code}}`}</div>
      </Tip>
    );
  } else if (spec.type === "boolean") {
    const on = lit === true || (lit === undefined && spec.default === true);
    control = (
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <Switch on={on} onChange={(v) => onChange(spec.optional && v === (spec.default ?? false) ? null : v)} ariaLabel={label} />
      </div>
    );
  } else if (spec.type === "enum") {
    const current = typeof lit === "string" ? lit : typeof spec.default === "string" ? spec.default : "";
    control = <Select value={current} placeholder="Not set" options={spec.options!.map((o) => ({ value: o, label: pretty(o) }))} onChange={(v) => onChange(v === spec.default ? null : v)} ariaLabel={label} />;
  } else if (spec.type === "number" && spec.min !== undefined && spec.max !== undefined) {
    const current = typeof lit === "number" ? lit : typeof spec.default === "number" ? spec.default : spec.min;
    control = <SliderField value={current} min={spec.min} max={spec.max} onCommit={(v) => onChange(v === spec.default ? null : v)} ariaLabel={label} />;
  } else if (spec.type === "number") {
    control = <NumberField value={typeof lit === "number" ? lit : null} placeholder={spec.default !== undefined ? String(spec.default) : ""} onCommit={(v) => onChange(v)} ariaLabel={label} />;
  } else if (spec.type === "color") {
    control = <ColorField value={typeof lit === "string" ? lit : ""} placeholder={typeof spec.default === "string" ? spec.default : ""} onCommit={(v) => onChange(v === null || v === spec.default ? null : v)} ariaLabel={label} />;
  } else if (spec.type === "colors") {
    const current = Array.isArray(lit) ? (lit as string[]) : Array.isArray(spec.default) ? (spec.default as string[]) : ["#ffffff"];
    control = <ColorList value={current} onCommit={(v) => onChange(same(v, spec.default) ? null : v)} />;
  } else if (spec.type === "string") {
    control = <TextField value={typeof lit === "string" ? lit : ""} placeholder={spec.default !== undefined ? String(spec.default) : ""} onCommit={(v) => onChange(v === "" ? null : v)} ariaLabel={label} />;
  } else {
    control = <div className="field readonly" title={spec.typeText}>{spec.type === "function" ? "ƒ function" : spec.typeText || "unknown"}</div>;
  }
  if (spec.type === "colors") {
    return (
      <div className={`prop wide-control${isSet ? " set" : ""}`} title={spec.description}>
        <label>{label}</label>
        {reset}
        <div style={{ gridColumn: "1 / -1" }}>{control}</div>
      </div>
    );
  }
  return (
    <div className={`prop${isSet ? " set" : ""}`} title={spec.description}>
      <label>{label}</label>
      {control}
      {reset}
    </div>
  );
}

function AttributesSection({ node }: { node: CanvasNode }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const keys = Object.keys(node.props).filter((k) => k !== "className" && k !== "data-name");
  if (!keys.length) return null;
  return (
    <Section title="Attributes">
      {keys.map((k) => (
        <PropControl key={k} spec={{ name: k, type: inferType(node.props[k]), optional: true, typeText: "" }} value={node.props[k]} onChange={(v) => run({ op: "set_props", canvas, id: node.id, props: { [k]: v } }, { select: false })} />
      ))}
    </Section>
  );
}

function ContentSection({ node }: { node: CanvasNode }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const text = node.children.map((c) => c.text ?? "").join(" ");
  return (
    <Section title="Content">
      <TextField multiline value={text} placeholder="Text" onCommit={(v) => run({ op: "set_text", canvas, id: node.id, text: v }, { select: false })} ariaLabel="Text content" />
    </Section>
  );
}

/** Shader (or any library) components that can fill a frame or layer. */
function BackgroundSection({ parentId }: { parentId: string }) {
  const canvas = useStore((s) => s.canvas)!;
  const run = useStore((s) => s.run);
  const components = useStore((s) => s.components);
  const shaders = components.filter((c) => c.library && c.acceptsClassName && c.presets?.length);
  const [shader, setShader] = useState("");
  if (!shaders.length) return null;
  const spec = shaders.find((c) => c.name === shader);
  return (
    <Section title={<span className="node-head"><Waves size={14} className="faint" /> Shader background</span>}>
      <div className="grid2" style={{ gridTemplateColumns: "1fr auto" }}>
        <Select
          value={shader}
          placeholder="Choose a shader"
          options={shaders.map((c) => ({ value: c.name, label: pretty(c.name), hint: `${c.presets!.length} presets`, icon: <Waves size={13} /> }))}
          onChange={setShader}
          ariaLabel="Shader"
        />
        <button
          className="btn primary"
          disabled={!spec}
          onClick={() => spec && run({ op: "add_background", canvas, parent: parentId, component: spec.name })}
        >
          Add
        </button>
      </div>
      <p className="faint" style={{ margin: "8px 0 0" }}>Fills the layer behind its content. Pick a preset in its props after.</p>
    </Section>
  );
}

function CodeSection({ id }: { id: string }) {
  const canvas = useStore((s) => s.canvas)!;
  const entry = useStore((s) => s.index.get(id));
  if (!entry) return null;
  return (
    <Section
      title="Code"
      actions={
        <>
          <CopyButton label="Copy JSX" text={() => api.source(canvas, rawId(id)).then((r) => r.code)} />
          <Tip label="Open in editor">
            <button className="icon-btn sm" onClick={() => openInEditor(id)} aria-label="Open in editor">
              <ExternalLink size={13} />
            </button>
          </Tip>
        </>
      }
    >
      <button className="link mono" onClick={() => openInEditor(id)}>
        <span>
          {/[jt]sx?#/.test(id) ? id.slice(0, id.lastIndexOf("#")) : useStore.getState().doc?.file}:{entry.node.line}
        </span>
      </button>
      <div className="grid2" style={{ marginTop: 10 }}>
        <button className="btn outline" onClick={duplicateSelection}>
          <CopyPlus size={14} /> Duplicate
        </button>
        <button className="btn danger outline" onClick={deleteSelection}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </Section>
  );
}
