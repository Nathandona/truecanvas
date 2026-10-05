import { useState } from "react";
import { createPortal } from "react-dom";
import { Component, LoaderCircle } from "lucide-react";
import { layerName, useStore } from "../lib/store";
import { insertionPoint } from "../lib/actions";
import { editComponent } from "../lib/elements";

const pascal = (s: string) =>
  s
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join("");
const kebab = (s: string) =>
  s
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Open the dialog: from the selected layer (Create component) or blank (New component). */
export function openComponentDialog(fromSelection: boolean) {
  const s = useStore.getState();
  const entry = fromSelection && s.selection.length === 1 ? s.index.get(s.selection[0]) : null;
  if (fromSelection && (!entry || entry.node.id === entry.frame.id || entry.node.kind === "text" || entry.node.kind === "expression")) {
    s.toast("Select one layer inside a frame (an element or a group) to turn it into a component.", "info");
    return;
  }
  useStore.setState({ componentDialog: { from: entry?.node.id ?? null } });
}

export function ComponentDialog() {
  const dialog = useStore((s) => s.componentDialog);
  const entry = useStore((s) => (dialog?.from ? s.index.get(dialog.from) : null));
  const dir = useStore((s) => s.componentsDir);
  if (!dialog) return null;
  return <Dialog key={dialog.from ?? "new"} from={dialog.from} suggestion={entry ? suggestName(entry.node) : ""} dir={dir} />;
}

function suggestName(n: Parameters<typeof layerName>[0]) {
  const name = layerName(n);
  const base = /^[a-z]/.test(name) && name.length <= 8 ? "" : pascal(name);
  return /^[A-Z]/.test(base) ? base : "";
}

function Dialog({ from, suggestion, dir }: { from: string | null; suggestion: string; dir: string }) {
  const [name, setName] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const close = () => useStore.setState({ componentDialog: null });
  const clean = pascal(name);
  const valid = /^[A-Z][A-Za-z0-9]*$/.test(clean);
  const create = async () => {
    if (!valid || busy) return;
    const s = useStore.getState();
    if (!s.canvas) return;
    setBusy(true);
    const at = from ? null : insertionPoint();
    const ids = await s.run({ op: "create_component", canvas: s.canvas, name: clean, ...(from ? { from } : at ? { parent: at.parent, index: at.index } : {}) });
    setBusy(false);
    if (!ids) return;
    close();
    s.toast(from ? `${clean} is a component now. Its instance replaced the layers.` : `Created ${clean}.`, "info", { label: "Edit main component", run: () => void editComponent(clean) });
  };
  return createPortal(
    <div className="modal-backdrop" onPointerDown={() => !busy && close()}>
      <div className="modal" style={{ width: 420 }} onPointerDown={(e) => e.stopPropagation()} onKeyDown={(e) => (e.stopPropagation(), e.key === "Escape" && !busy && close())}>
        <div className="modal-title">{from ? "Create component" : "New component"}</div>
        <p className="muted">
          {from ? "The selected layers move into a new component file and are replaced by an instance of it. Their imports come along." : "A new component file with a starter design. Edit it on the canvas, or ask your agent."}
        </p>
        <div className="field" style={{ marginBottom: 6 }}>
          <span className="prefix">
            <Component size={13} />
          </span>
          <input
            autoFocus
            value={name}
            placeholder="PricingCard"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void create()}
            aria-label="Component name"
            spellCheck={false}
          />
        </div>
        <div className="faint git-note" style={{ marginBottom: 14 }}>
          {valid ? (
            <>
              <span className="mono">
                {dir}/{kebab(clean)}.tsx
              </span>{" "}
              exports <span className="mono">{clean}</span>
            </>
          ) : (
            "Letters and digits, starting with a letter."
          )}
        </div>
        <div className="modal-actions">
          <button className="btn outline" disabled={busy} onClick={close}>
            Cancel
          </button>
          <button className="btn primary" disabled={!valid || busy} onClick={() => void create()}>
            {busy && <LoaderCircle size={13} className="spin-working" />} {from ? "Create component" : "Create"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
