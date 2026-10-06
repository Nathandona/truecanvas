/* The right-click menu for layers (canvas and layers panel). */
import { fileName } from "./canvasShared";
import { Component, ArrowUpFromLine, Play, RotateCcw, Code2, Copy, CopyPlus, CornerLeftUp, ExternalLink, FileCode2, FlaskConical, LayoutList, Trash2 } from "lucide-react";
import { useStore } from "../lib/store";
import { applyToPage, exploreCopy, copySelectionCode, deleteSelection, duplicateSelection, kbd, openInEditor, playFrame, replayFrame, selectParent, wrapSelection } from "../lib/actions";
import { api } from "../lib/api";
import { Menu, type MenuItem } from "./Menu";
import { editComponent } from "../lib/elements";
import { openComponentDialog } from "./ComponentDialog";

export function CanvasMenu({ x, y, onClose, extra = [] }: { x: number; y: number; onClose: () => void; extra?: (MenuItem | "sep")[] }) {
  const s = useStore.getState();
  const single = s.selection.length === 1 ? s.index.get(s.selection[0]) : null;
  const isFrame = single && single.node.id === single.frame.id;
  const frame = single?.frame;
  const items: (MenuItem | "sep")[] = [
    ...(frame?.link
      ? [
          { label: "Explore a copy", icon: <FlaskConical size={14} />, onSelect: () => void exploreCopy(frame.id) },
          { label: `Open ${fileName(frame.link.page)}`, icon: <FileCode2 size={14} />, onSelect: () => void api.openFile(frame.link!.page).catch((e) => s.toast((e as Error).message)) },
          "sep" as const,
        ]
      : []),
    ...(frame
      ? [
          { label: `Play ${frame.frameName}`, icon: <Play size={14} />, onSelect: () => playFrame(frame.frameName) },
          { label: "Replay animations", icon: <RotateCcw size={14} />, onSelect: () => replayFrame(frame.frameName) },
          "sep" as const,
        ]
      : []),
    ...(frame?.from && isFrame ? [{ label: `Apply to ${fileName(frame.from)}`, icon: <ArrowUpFromLine size={14} />, onSelect: () => void applyToPage(frame.id) }, "sep" as const] : []),
    { label: "Duplicate", icon: <CopyPlus size={14} />, kbd: kbd.dup, onSelect: duplicateSelection },
    ...(!isFrame ? [{ label: "Wrap in auto layout", icon: <LayoutList size={14} />, kbd: "⇧A", onSelect: wrapSelection }] : []),
    ...(single?.parent ? [{ label: "Select parent", icon: <CornerLeftUp size={14} />, kbd: "⇧Enter", onSelect: selectParent }] : []),
    "sep",
    { label: "Copy as JSX", icon: <Copy size={14} />, kbd: kbd.copy, onSelect: () => void copySelectionCode() },
    { label: "Show this layer in code", icon: <ExternalLink size={14} />, onSelect: () => openInEditor(single?.node.id) },
    ...(single && single.node.kind === "component" && s.components.some((c) => c.name === single.node.name && !c.library)
      ? [
          { label: `Edit ${single.node.name} (main component)`, icon: <Component size={14} />, onSelect: () => void editComponent(single.node.name) },
          { label: `Open ${single.node.name} in code editor`, icon: <Code2 size={14} />, onSelect: () => goToComponent(single.node.name) },
        ]
      : []),
    ...(single && !isFrame && (single.node.kind === "element" || single.node.kind === "component" || single.node.kind === "fragment")
      ? [{ label: "Create component", icon: <Component size={14} />, kbd: `${kbd.mod}⌥K`, onSelect: () => openComponentDialog(true) }]
      : []),
    "sep",
    { label: "Delete", icon: <Trash2 size={14} />, kbd: "Del", danger: true, onSelect: deleteSelection },
  ];
  return <Menu x={x} y={y} items={extra.length ? [...extra, "sep", ...items] : items} onClose={onClose} />;
}

export function goToComponent(name: string) {
  const s = useStore.getState();
  const spec = s.components.find((c) => c.name === name);
  if (spec) void api.openFile(spec.file).catch((e) => s.toast((e as Error).message));
}
