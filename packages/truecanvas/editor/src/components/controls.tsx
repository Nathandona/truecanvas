import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Copy, Plus, X } from "lucide-react";

// ---------- Tooltip ----------

export function Tip({ label, kbd, children, side = "top" }: { label: string; kbd?: string; children: ReactNode; side?: "top" | "bottom" | "left" }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const timer = useRef<number>(0);
  const show = () => {
    timer.current = window.setTimeout(() => {
      const el = ref.current?.firstElementChild ?? ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos(side === "bottom" ? { x: r.left + r.width / 2, y: r.bottom + 8 } : side === "left" ? { x: r.left - 8, y: r.top + r.height / 2 } : { x: r.left + r.width / 2, y: r.top - 8 });
    }, 450);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setPos(null);
  };
  return (
    <span ref={ref} onPointerEnter={show} onPointerLeave={hide} onPointerDown={hide} style={{ display: "contents" }}>
      {children}
      {pos &&
        createPortal(
          <div
            className="tooltip"
            style={{
              left: pos.x,
              top: pos.y,
              transform: side === "top" ? "translate(-50%, -100%)" : side === "left" ? "translate(-100%, -50%)" : "translate(-50%, 0)",
            }}
          >
            {label}
            {kbd && <span className="kbd">{kbd}</span>}
          </div>,
          document.body,
        )}
    </span>
  );
}

// ---------- Text field: commits on Enter / blur, Escape reverts ----------

export function TextField({
  value,
  onCommit,
  placeholder,
  prefix,
  mono,
  multiline,
  autoFocus,
  ariaLabel,
}: {
  value: string;
  onCommit: (v: string) => void;
  placeholder?: string;
  prefix?: ReactNode;
  mono?: boolean;
  multiline?: boolean;
  autoFocus?: boolean;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setDraft(value);
  }, [value]);
  const commit = () => {
    editing.current = false;
    if (draft !== value) onCommit(draft);
  };
  const common = {
    value: draft,
    placeholder,
    "aria-label": ariaLabel,
    autoFocus,
    spellCheck: false,
    onFocus: () => (editing.current = true),
    onChange: (e: { target: { value: string } }) => setDraft(e.target.value),
    onBlur: commit,
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.stopPropagation();
      if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey || !e.shiftKey)) {
        e.preventDefault();
        (e.target as HTMLElement).blur();
      }
      if (e.key === "Escape") {
        editing.current = false;
        setDraft(value);
        requestAnimationFrame(() => (e.target as HTMLElement).blur());
      }
    },
  };
  return (
    <div className={`field${mono ? " mono" : ""}${multiline ? " area" : ""}`}>
      {prefix && <span className="prefix">{prefix}</span>}
      {multiline ? <textarea rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 30)))} {...common} /> : <input {...common} />}
    </div>
  );
}

// ---------- Number field with drag-to-scrub prefix ----------

export function NumberField({
  value,
  onCommit,
  prefix,
  placeholder,
  min,
  step = 1,
  ariaLabel,
}: {
  value: number | null;
  onCommit: (v: number | null) => void;
  prefix?: ReactNode;
  placeholder?: string;
  min?: number;
  step?: number;
  ariaLabel?: string;
}) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));
  const [scrub, setScrub] = useState<number | null>(null);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current && scrub === null) setDraft(value === null ? "" : String(value));
  }, [value, scrub]);
  const clamp = (n: number) => (min !== undefined ? Math.max(min, n) : n);
  const commitDraft = () => {
    editing.current = false;
    const trimmed = draft.trim();
    if (trimmed === "") return value !== null && onCommit(null);
    let n: number;
    try {
      // allow simple math: 12*2, 100-8
      n = /^[\d+\-*/. ()]+$/.test(trimmed) ? Number(Function(`"use strict";return (${trimmed})`)()) : Number(trimmed);
    } catch {
      n = Number.NaN;
    }
    if (!Number.isFinite(n)) return setDraft(value === null ? "" : String(value));
    n = clamp(Math.round(n * 100) / 100);
    setDraft(String(n));
    if (n !== value) onCommit(n);
  };
  const onScrubStart = (e: React.PointerEvent) => {
    if (value === null && placeholder === undefined) return;
    e.preventDefault();
    const startX = e.clientX;
    const start = value ?? Number(placeholder) ?? 0;
    let current = start;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      current = clamp(Math.round(start + ((ev.clientX - startX) / 2) * step * (ev.shiftKey ? 10 : 1)));
      setScrub(current);
      setDraft(String(current));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setScrub(null);
      if (current !== value) onCommit(current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div className="field">
      {prefix && (
        <span className="prefix" style={{ cursor: "ew-resize" }} onPointerDown={onScrubStart}>
          {prefix}
        </span>
      )}
      <input
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        inputMode="decimal"
        onFocus={(e) => {
          editing.current = true;
          e.target.select();
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitDraft}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") {
            editing.current = false;
            setDraft(value === null ? "" : String(value));
            requestAnimationFrame(() => (e.target as HTMLElement).blur());
          }
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            const base = Number(draft || placeholder || 0);
            const n = clamp(base + (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1));
            setDraft(String(n));
            onCommit(n);
          }
        }}
      />
    </div>
  );
}

// ---------- Select ----------

export interface SelectOption {
  value: string;
  label: string;
  /** secondary text on the right, e.g. "4 presets" or "393×852" */
  hint?: string;
  icon?: ReactNode;
  /** a non-selectable group heading */
  heading?: boolean;
}

/** Custom dropdown: keyboard friendly (↑↓ Enter Esc, type to jump), styled like the rest of the UI. */
export function Select({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [pos, setPos] = useState<{ left: number; top: number; width: number; up: boolean } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const selectable = options.map((o, i) => (o.heading ? -1 : i)).filter((i) => i >= 0);
  const current = options.find((o) => o.value === value && !o.heading);

  const place = () => {
    const r = trigger.current!.getBoundingClientRect();
    const height = Math.min(320, options.length * 30 + 10);
    const up = r.bottom + height + 8 > window.innerHeight && r.top > height;
    setPos({ left: r.left, top: up ? r.top - 4 : r.bottom + 4, width: Math.max(r.width, 200), up });
  };
  const openList = () => {
    place();
    setActive(Math.max(0, options.findIndex((o) => o.value === value && !o.heading)));
    setOpen(true);
  };
  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.heading) return;
    close();
    if (o.value !== value) onChange(o.value);
  };
  const move = (dir: 1 | -1) => {
    const at = selectable.indexOf(active);
    const next = selectable[Math.min(selectable.length - 1, Math.max(0, (at < 0 ? -1 : at) + dir))];
    if (next !== undefined) setActive(next);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!list.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) close(false);
    };
    const reflow = () => close(false);
    window.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", reflow);
    return () => {
      window.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", reflow);
    };
  }, [open]);

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === "ArrowDown") (e.preventDefault(), move(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), move(-1));
    else if (e.key === "Home") (e.preventDefault(), setActive(selectable[0]));
    else if (e.key === "End") (e.preventDefault(), setActive(selectable[selectable.length - 1]));
    else if (e.key === "Enter" || e.key === " ") (e.preventDefault(), choose(active));
    else if (e.key === "Escape" || e.key === "Tab") close(e.key === "Escape");
    else if (e.key.length === 1) {
      // type to jump
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const hit = selectable.find((i) => options[i].label.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    }
  };

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`select-trigger${open ? " open" : ""}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
      >
        {current?.icon && <span className="opt-icon">{current.icon}</span>}
        <span className={`label${current ? "" : " placeholder"}`}>{current?.label ?? placeholder ?? ""}</span>
        <ChevronDown size={14} className="chev" />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={list}
            className={`listbox${pos.up ? " up" : ""}`}
            role="listbox"
            aria-label={ariaLabel}
            style={{ left: pos.left, top: pos.top, minWidth: pos.width, transform: pos.up ? "translateY(-100%)" : undefined }}
            onKeyDown={onKeyDown}
          >
            {options.map((o, i) =>
              o.heading ? (
                <div key={`h${i}`} className="listbox-heading">
                  {o.label}
                </div>
              ) : (
                <div
                  key={o.value}
                  data-i={i}
                  role="option"
                  aria-selected={o.value === value}
                  className={`listbox-option${i === active ? " active" : ""}`}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                >
                  <span className="check">{o.value === value && <Check size={13} />}</span>
                  {o.icon && <span className="opt-icon">{o.icon}</span>}
                  <span className="label">{o.label}</span>
                  {o.hint && <span className="hint">{o.hint}</span>}
                </div>
              ),
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

export function Switch({ on, onChange, ariaLabel }: { on: boolean; onChange: (v: boolean) => void; ariaLabel?: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={ariaLabel} className={`switch${on ? " on" : ""}`} onClick={() => onChange(!on)} />;
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label?: string; icon?: ReactNode; title?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} title={o.title} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)}>
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string | (() => Promise<string>); label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tip label={done ? "Copied" : label}>
      <button
        type="button"
        className="icon-btn sm"
        aria-label={label}
        onClick={async () => {
          const value = typeof text === "string" ? text : await text();
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1400);
        }}
      >
        {done ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </Tip>
  );
}

export function Section({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <div className="section">
      {title && (
        <div className="section-title">
          <span>{title}</span>
          {actions && <span className="actions">{actions}</span>}
        </div>
      )}
      {children}
    </div>
  );
}

export function useClickOutside(ref: React.RefObject<HTMLElement | null>, onOutside: () => void, active = true) {
  useEffect(() => {
    if (!active) return;
    const handler = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    window.addEventListener("pointerdown", handler, true);
    return () => window.removeEventListener("pointerdown", handler, true);
  }, [ref, onOutside, active]);
}

// ---------- Color ----------

/** #rgb/#rrggbb/#rrggbbaa → #rrggbb for <input type=color>; other formats stay text-only. */
function toHex6(v: string): string | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(v.trim());
  if (!m) return null;
  const h = m[1];
  if (h.length === 3 || h.length === 4) return `#${h.slice(0, 3).split("").map((c) => c + c).join("")}`;
  if (h.length === 6 || h.length === 8) return `#${h.slice(0, 6)}`;
  return null;
}

function Swatch({ value, onPick, label }: { value: string; onPick: (v: string) => void; label: string }) {
  const hex = toHex6(value);
  return (
    <label className="swatch" style={{ background: value || "transparent" }} aria-label={label}>
      <input
        type="color"
        value={hex ?? "#000000"}
        onChange={(e) => onPick(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}

export function ColorField({ value, placeholder, onCommit, ariaLabel }: { value: string; placeholder?: string; onCommit: (v: string | null) => void; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  // native pickers fire on every drag step: commit once the user stops
  const timer = useRef<number>(0);
  const pick = (v: string) => {
    setDraft(v);
    clearTimeout(timer.current);
    timer.current = window.setTimeout(() => onCommit(v), 250);
  };
  return (
    <div className="field">
      <span className="prefix" style={{ paddingLeft: 5 }}>
        <Swatch value={draft || placeholder || ""} onPick={pick} label={ariaLabel ?? "Color"} />
      </span>
      <input
        className="mono-input"
        value={draft}
        placeholder={placeholder}
        aria-label={ariaLabel}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft !== value && onCommit(draft.trim() || null)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter") (e.target as HTMLElement).blur();
          if (e.key === "Escape") setDraft(value);
        }}
      />
    </div>
  );
}

export function ColorList({ value, onCommit }: { value: string[]; onCommit: (v: string[]) => void }) {
  const [list, setList] = useState(value);
  useEffect(() => setList(value), [value]);
  const timer = useRef<number>(0);
  const update = (next: string[], debounce = false) => {
    setList(next);
    clearTimeout(timer.current);
    if (debounce) timer.current = window.setTimeout(() => onCommit(next), 250);
    else onCommit(next);
  };
  return (
    <div className="color-list">
      {list.map((c, i) => (
        <div key={i} className="color-chip">
          <Swatch value={c} label={`Color ${i + 1}`} onPick={(v) => update(list.map((x, j) => (j === i ? v : x)), true)} />
          {list.length > 1 && (
            <button className="remove" aria-label={`Remove color ${i + 1}`} onClick={() => update(list.filter((_, j) => j !== i))}>
              <X size={9} />
            </button>
          )}
        </div>
      ))}
      <button className="icon-btn sm" aria-label="Add color" onClick={() => update([...list, list[list.length - 1] ?? "#ffffff"])}>
        <Plus size={13} />
      </button>
    </div>
  );
}

// ---------- Slider ----------

export function SliderField({ value, min, max, onCommit, ariaLabel }: { value: number; min: number; max: number; onCommit: (v: number) => void; ariaLabel?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const step = max - min <= 2 ? 0.01 : max - min <= 20 ? 0.1 : 1;
  const round = (n: number) => Math.round(n / step) * step;
  return (
    <div className="slider-field">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={draft}
        aria-label={ariaLabel}
        style={{ ["--p" as string]: `${((draft - min) / (max - min)) * 100}%` }}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={() => draft !== value && onCommit(Number(round(draft).toFixed(3)))}
        onKeyUp={() => draft !== value && onCommit(Number(round(draft).toFixed(3)))}
        onKeyDown={(e) => e.stopPropagation()}
      />
      <NumberField value={Number(draft.toFixed(3))} onCommit={(v) => v !== null && onCommit(v)} ariaLabel={ariaLabel} step={step} />
    </div>
  );
}
