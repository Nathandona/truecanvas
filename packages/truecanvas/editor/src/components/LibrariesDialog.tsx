import { useEffect, useMemo, useState } from "react";
import { Check, Download, ExternalLink, LoaderCircle, Search } from "lucide-react";
import { api, type LibraryState } from "../lib/api";
import { useStore } from "../lib/store";
import { insertionPoint } from "../lib/actions";
import { Dialog } from "./Dialog";

/*
 * Libraries: icon sets (installed with the project's package manager, then
 * searched and inserted with their import) and shadcn/ui components (copied
 * into the project by the shadcn CLI, then in Assets like any component).
 */

export type LibraryTab = "icons" | "shadcn";

export function openLibraries(tab: LibraryTab = "icons") {
  useStore.setState({ libraryDialog: { tab } });
}

export function LibrariesDialog() {
  const dialog = useStore((s) => s.libraryDialog);
  if (!dialog) return null;
  return <Libraries initialTab={dialog.tab} />;
}

function Libraries({ initialTab }: { initialTab: LibraryTab }) {
  const [tab, setTab] = useState<LibraryTab>(initialTab);
  const [state, setState] = useState<LibraryState | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const close = () => useStore.setState({ libraryDialog: null });
  useEffect(() => {
    let stale = false;
    api
      .libraries()
      .then((s) => !stale && setState(s))
      .catch((err) => useStore.getState().toast((err as Error).message));
    return () => {
      stale = true;
    };
  }, []);
  return (
    <Dialog title="Libraries" width={620} busy={!!busy} onClose={close}>
      <div className="tabs lib-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "icons"} className={`tab ${tab === "icons" ? "on" : ""}`} onClick={() => setTab("icons")}>
          Icons
        </button>
        <button role="tab" aria-selected={tab === "shadcn"} className={`tab ${tab === "shadcn" ? "on" : ""}`} onClick={() => setTab("shadcn")}>
          shadcn/ui
        </button>
      </div>
      {!state ? (
        <div className="lib-loading">
          <LoaderCircle size={16} className="spin-working" />
        </div>
      ) : tab === "icons" ? (
        <IconsTab state={state} setState={setState} busy={busy} setBusy={setBusy} onInserted={close} />
      ) : (
        <ShadcnTab state={state} setState={setState} busy={busy} setBusy={setBusy} />
      )}
    </Dialog>
  );
}

type TabProps = { state: LibraryState; setState: (s: LibraryState) => void; busy: string | null; setBusy: (b: string | null) => void };

function IconsTab({ state, setState, busy, setBusy, onInserted }: TabProps & { onInserted: () => void }) {
  const installed = state.icons.filter((l) => l.version);
  const [library, setLibrary] = useState(installed[0]?.id ?? null);
  const [showAll, setShowAll] = useState(!installed.length);
  const install = async (id: string) => {
    const lib = state.icons.find((l) => l.id === id)!;
    setBusy(`Installing ${lib.package} with ${state.packageManager}…`);
    try {
      const res = await api.installIcons(id);
      setState(res.state);
      if (!res.ok) return useStore.getState().toast(`Couldn't install ${lib.package}. ${lastLine(res.out)}`);
      setLibrary(id);
      setShowAll(false);
    } catch (err) {
      useStore.getState().toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (busy) return <Busy text={busy} />;
  if (showAll || !library) {
    return (
      <div className="lib-list">
        <p className="muted">Pick an icon set. It's added to your project with {state.packageManager}, then you can search and insert icons.</p>
        {state.icons.map((l) => (
          <div key={l.id} className="lib-row">
            <div className="lib-row-text">
              <span className="lib-name">{l.label}</span>
              <span className="faint mono">{l.package}</span>
            </div>
            <a className="icon-btn" href={l.homepage} target="_blank" rel="noreferrer" aria-label={`${l.label} website`} title="Website">
              <ExternalLink size={13} />
            </a>
            {l.version ? (
              <button
                className="btn outline"
                onClick={() => {
                  setLibrary(l.id);
                  setShowAll(false);
                }}
              >
                <Check size={13} /> Use
              </button>
            ) : (
              <button className="btn outline" onClick={() => void install(l.id)}>
                <Download size={13} /> Install
              </button>
            )}
          </div>
        ))}
      </div>
    );
  }
  return <IconPicker library={library} libraries={installed} onLibrary={setLibrary} onMore={() => setShowAll(true)} onInserted={onInserted} />;
}

function IconPicker({ library, libraries, onLibrary, onMore, onInserted }: { library: string; libraries: LibraryState["icons"]; onLibrary: (id: string) => void; onMore: () => void; onInserted: () => void }) {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ total: number; icons: { name: string; svg: string }[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let stale = false;
    // first load renders the whole set once (a second or two); typing stays quick after
    const t = setTimeout(
      () =>
        api
          .icons(library, query)
          .then((r) => !stale && (setResult(r), setError(null)))
          .catch((err) => !stale && setError((err as Error).message)),
      query ? 120 : 0,
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [library, query]);
  const insert = async (name: string) => {
    const s = useStore.getState();
    const at = insertionPoint();
    if (!s.canvas || !at) return s.toast("Add a frame first: press F and drag on the canvas.", "info");
    const ids = await s.run({ op: "insert_icon", canvas: s.canvas, parent: at.parent, index: at.index, library, name });
    if (ids) onInserted();
  };
  return (
    <div className="icon-picker">
      <div className="icon-picker-bar">
        <div className="field search-field">
          <span className="prefix">
            <Search size={13} />
          </span>
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search icons" aria-label="Search icons" spellCheck={false} />
        </div>
        <select className="lib-select" value={library} onChange={(e) => (e.target.value === "__more" ? onMore() : onLibrary(e.target.value))} aria-label="Icon library">
          {libraries.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
          <option value="__more">More libraries…</option>
        </select>
      </div>
      {error ? (
        <div className="lib-empty">{error}</div>
      ) : !result ? (
        <Busy text="Loading icons…" />
      ) : !result.icons.length ? (
        <div className="lib-empty">No icons match “{query}”.</div>
      ) : (
        <>
          <div className="icon-grid">
            {result.icons.map((icon) => (
              <button key={icon.name} className="icon-cell" title={icon.name} aria-label={`Insert ${icon.name}`} onClick={() => void insert(icon.name)}>
                <SvgPreview svg={icon.svg} />
              </button>
            ))}
          </div>
          <div className="faint lib-foot">
            {result.total > result.icons.length ? `Showing ${result.icons.length} of ${result.total}. Search to narrow down.` : `${result.total} icons`} · Inserted after the selection, with its import.
          </div>
        </>
      )}
    </div>
  );
}

/** Icon markup comes from the project's installed package: shown as inert SVG only. */
function SvgPreview({ svg }: { svg: string }) {
  const safe = useMemo(() => sanitizeSvg(svg), [svg]);
  return <span className="icon-svg" dangerouslySetInnerHTML={{ __html: safe }} />;
}

function sanitizeSvg(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  if (root.nodeName !== "svg") return "";
  for (const el of [...root.querySelectorAll("script, foreignObject, iframe, object, embed")]) el.remove();
  for (const el of [root, ...root.querySelectorAll("*")]) {
    for (const attr of [...el.attributes]) {
      if (/^on/i.test(attr.name) || (/href$/i.test(attr.name) && /^\s*javascript:/i.test(attr.value))) el.removeAttribute(attr.name);
    }
  }
  return new XMLSerializer().serializeToString(root);
}

function ShadcnTab({ state, setState, busy, setBusy }: TabProps) {
  const [registry, setRegistry] = useState<{ names: string[]; offline: boolean } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  useEffect(() => {
    let stale = false;
    api
      .shadcnRegistry()
      .then((r) => !stale && setRegistry(r))
      .catch((err) => useStore.getState().toast((err as Error).message));
    return () => {
      stale = true;
    };
  }, []);
  const installed = new Set(state.shadcn.installed);
  const names = (registry?.names ?? []).filter((n) => n.includes(query.trim().toLowerCase()));
  const toggle = (n: string) => {
    const next = new Set(picked);
    if (next.has(n)) next.delete(n);
    else next.add(n);
    setPicked(next);
  };
  const add = async () => {
    const list = [...picked];
    setBusy(`${state.shadcn.initialized ? "Adding" : "Setting up shadcn/ui and adding"} ${list.join(", ")}…`);
    try {
      const res = await api.addShadcn(list);
      setState(res.state);
      if (!res.ok) return useStore.getState().toast(`shadcn couldn't add them. ${lastLine(res.out)}`);
      setPicked(new Set());
      useStore.getState().toast(res.added.length ? `Added ${res.added.join(", ")}. They're in Assets now.` : "Those components were already in your project.", "info");
    } catch (err) {
      useStore.getState().toast((err as Error).message);
    } finally {
      setBusy(null);
    }
  };
  if (busy) return <Busy text={busy} />;
  return (
    <div className="shadcn-tab">
      <p className="muted">
        {state.shadcn.initialized ? (
          <>
            Components are copied into <span className="mono">{state.shadcn.uiDir}</span> as code you own, then show up in Assets.
          </>
        ) : (
          <>The first add sets shadcn/ui up: components.json, lib/utils and theme variables in your global CSS. Components are copied into your project as code you own.</>
        )}
      </p>
      <div className="field search-field">
        <span className="prefix">
          <Search size={13} />
        </span>
        <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search components" aria-label="Search components" spellCheck={false} />
      </div>
      {!registry ? (
        <Busy text="Loading the registry…" />
      ) : (
        <div className="shadcn-grid">
          {names.map((n) => {
            const has = installed.has(n);
            return (
              <button key={n} className={`shadcn-item ${picked.has(n) ? "on" : ""}`} disabled={has} aria-pressed={picked.has(n)} onClick={() => toggle(n)}>
                <span className="shadcn-check">{(has || picked.has(n)) && <Check size={11} />}</span>
                {n}
                {has && <span className="faint">added</span>}
              </button>
            );
          })}
        </div>
      )}
      <div className="modal-actions lib-actions">
        {registry?.offline && <span className="faint">Offline: showing the usual components.</span>}
        <button className="btn primary" disabled={!picked.size} onClick={() => void add()}>
          {picked.size ? `Add ${picked.size} component${picked.size === 1 ? "" : "s"}` : "Pick components"}
        </button>
      </div>
    </div>
  );
}

function Busy({ text }: { text: string }) {
  return (
    <div className="lib-loading" role="status">
      <LoaderCircle size={16} className="spin-working" /> <span className="muted">{text}</span>
    </div>
  );
}

const lastLine = (out: string) => out.trim().split("\n").filter(Boolean).slice(-2).join(" ");
