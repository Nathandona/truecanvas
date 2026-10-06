import { api } from "./api";
import { refreshRects } from "./bridge";
import { insertionPoint, revealOnCanvas } from "./actions";
import { useStore } from "./store";

/** Plain HTML building blocks, inserted as Tailwind-styled JSX. `edit`: start typing its text right away. */
export interface ElementDef {
  key: string;
  label: string;
  group: "Text" | "Layout" | "Media & forms";
  jsx: string;
  edit?: boolean;
  kbd?: string;
}

export const ELEMENTS: ElementDef[] = [
  { key: "text", label: "Text", group: "Text", kbd: "T", edit: true, jsx: `<p className="text-base text-neutral-700">Text</p>` },
  { key: "h1", label: "Heading 1", group: "Text", edit: true, jsx: `<h1 className="text-5xl font-semibold tracking-tight">Heading</h1>` },
  { key: "h2", label: "Heading 2", group: "Text", edit: true, jsx: `<h2 className="text-3xl font-semibold tracking-tight">Heading</h2>` },
  { key: "h3", label: "Heading 3", group: "Text", edit: true, jsx: `<h3 className="text-xl font-semibold">Heading</h3>` },
  { key: "link", label: "Link", group: "Text", edit: true, jsx: `<a href="#" className="font-medium underline underline-offset-4">Link</a>` },
  { key: "button", label: "Button", group: "Text", edit: true, jsx: `<button className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white">Button</button>` },
  { key: "list", label: "List", group: "Text", jsx: `<ul className="list-disc space-y-1 pl-6">\n  <li>First item</li>\n  <li>Second item</li>\n</ul>` },
  { key: "stack", label: "Stack", group: "Layout", jsx: `<div className="flex flex-col gap-4">\n  <p>Item</p>\n  <p>Item</p>\n</div>` },
  { key: "row", label: "Row", group: "Layout", jsx: `<div className="flex items-center gap-4">\n  <p>Item</p>\n  <p>Item</p>\n</div>` },
  { key: "grid", label: "Grid", group: "Layout", jsx: `<div className="grid grid-cols-3 gap-4">\n  <div className="rounded-lg bg-neutral-100 p-6">1</div>\n  <div className="rounded-lg bg-neutral-100 p-6">2</div>\n  <div className="rounded-lg bg-neutral-100 p-6">3</div>\n</div>` },
  { key: "box", label: "Box", group: "Layout", jsx: `<div className="rounded-xl border border-neutral-200 p-6">\n  <p>Box</p>\n</div>` },
  { key: "section", label: "Section", group: "Layout", jsx: `<section className="mx-auto max-w-5xl px-6 py-16">\n  <h2 className="text-3xl font-semibold tracking-tight">Section</h2>\n</section>` },
  { key: "divider", label: "Divider", group: "Layout", jsx: `<hr className="border-neutral-200" />` },
  { key: "image", label: "Image", group: "Media & forms", jsx: `<img src="https://placehold.co/800x500" alt="" className="h-auto w-full rounded-xl" />` },
  { key: "input", label: "Input", group: "Media & forms", jsx: `<input placeholder="Type here" className="rounded-lg border border-neutral-300 px-3 py-2 text-sm" />` },
];

/** Inserts an element next to / into the selection, selects it and, for text, starts editing. */
export async function insertElement(el: ElementDef) {
  const s = useStore.getState();
  const at = insertionPoint();
  if (!s.canvas || !at) {
    s.toast("Add a frame first: press F and drag on the canvas.", "info");
    return;
  }
  const ids = await s.run({ op: "insert_jsx", canvas: s.canvas, parent: at.parent, index: at.index, jsx: el.jsx });
  const id = ids?.[0];
  if (!id || !el.edit) return;
  // the frame re-renders after the file changes: wait for the new layer to be measured
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 150));
    await refreshRects();
    if (useStore.getState().rects[id]) {
      useStore.setState({ editingText: id });
      return;
    }
  }
}

/** Opens a component's main frame on the "components" page (made on first use). */
export async function editComponent(name: string) {
  const s = useStore.getState();
  try {
    const res = await api.command({ op: "add_component_frame", canvas: "components", component: name });
    if (s.canvas === "components") s.setDoc(res.doc);
    revealOnCanvas("components", res.ids);
  } catch (e) {
    s.toast((e as Error).message);
  }
}
