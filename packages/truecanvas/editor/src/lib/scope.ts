import type { CanvasDoc, CanvasNode } from "./api";

/*
 * Two linked frames of the same page (Home and Home mobile) show the same
 * layers, so they carry the same ids. Inside the editor, an id that appears in
 * several frames is scoped to its frame (`page.tsx#12:4|<frame id>`) so hover,
 * selection and measurements stay per frame. The server, the files and the
 * frames' DOM only ever see the raw id.
 */

const SEP = "|";

export const rawId = (id: string) => {
  const i = id.indexOf(SEP);
  return i < 0 ? id : id.slice(0, i);
};

/** Scopes ids that more than one frame contains. */
export function scopeDoc(doc: CanvasDoc): CanvasDoc {
  const seen = new Map<string, number>();
  const count = (n: CanvasNode) => {
    seen.set(n.id, (seen.get(n.id) ?? 0) + 1);
    n.children.forEach(count);
  };
  for (const f of doc.frames) f.children.forEach(count);
  if (![...seen.values()].some((c) => c > 1)) return doc;
  const scope = (n: CanvasNode, frameId: string): CanvasNode => ({
    ...n,
    id: (seen.get(n.id) ?? 0) > 1 ? `${n.id}${SEP}${frameId}` : n.id,
    children: n.children.map((c) => scope(c, frameId)),
  });
  return { ...doc, frames: doc.frames.map((f) => ({ ...f, children: f.children.map((c) => scope(c, f.id)) })) };
}

/** The editor id of a raw id inside one frame. */
export function inFrame(index: Map<string, unknown>, frameId: string | undefined, raw: string): string {
  if (frameId && index.has(`${raw}${SEP}${frameId}`)) return `${raw}${SEP}${frameId}`;
  return raw;
}

/** The editor id of a raw id from the server: in the preferred frame when it's in several. */
export function fromServer(index: Map<string, { frame: { id: string } }>, raw: string, preferFrame?: string | null): string {
  if (index.has(raw)) return raw;
  if (preferFrame && index.has(`${raw}${SEP}${preferFrame}`)) return `${raw}${SEP}${preferFrame}`;
  for (const key of index.keys()) if (key.startsWith(`${raw}${SEP}`)) return key;
  return raw;
}

/** A command with the editor's scoped ids turned back into file ids. */
export function unscopeCommand<T extends object>(cmd: T): T {
  const out = { ...cmd } as Record<string, unknown>;
  for (const key of ["id", "parent", "from"]) if (typeof out[key] === "string") out[key] = rawId(out[key] as string);
  if (Array.isArray(out.ids)) out.ids = [...new Set((out.ids as string[]).map(rawId))];
  return out as T;
}
