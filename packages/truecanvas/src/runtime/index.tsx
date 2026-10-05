import { createContext, useContext, type ReactNode } from "react";

/** Set by the render route: which frame this document is rendering. */
export const HostContext = createContext<{ frame: string | null } | null>(null);

export interface CanvasProps {
  children?: ReactNode;
}

/** Root of a canvas file. Its children are <Frame>s. */
export function Canvas({ children }: CanvasProps) {
  return <>{children}</>;
}

export interface FrameProps {
  /** Unique name, shown above the frame on the canvas. */
  name: string;
  /** Position on the canvas, in px. */
  x?: number;
  y?: number;
  /** Frame width in px: the viewport width your components see. */
  width: number;
  /** Fixed height in px. Omit to hug the content. */
  height?: number;
  /** Force a theme for this frame. Omit to inherit the canvas theme. */
  theme?: "light" | "dark";
  /** Device preset (e.g. "iphone-16"): device chrome in the editor, mobile emulation in screenshots. */
  device?: string;
  /** Linked frame: the App Router page it shows (project-relative). Editing its layers edits that page. */
  page?: string;
  /** Exploration of this page file: "Apply to page" writes the frame back to it. */
  from?: string;
  /** Main component frame, "components/button.tsx#Button": its layers are that component's JSX. */
  component?: string;
  children?: ReactNode;
}

/**
 * An artboard. Inside the editor each frame renders in its own iframe at its
 * own width, so media queries, portals and fixed positioning behave like the
 * real app. Rendered anywhere else it is just a sized box.
 */
export function Frame({ name, width, height, children }: FrameProps) {
  const host = useContext(HostContext);
  if (host) {
    if (host.frame !== name) return null;
    return (
      <div data-tc-frame={name} style={{ width: "100%", height: height ? "100vh" : undefined, display: "flow-root", position: "relative", isolation: "isolate" }}>
        {children}
      </div>
    );
  }
  return (
    <div data-tc-frame={name} style={{ width, height, overflow: "hidden", position: "relative", display: "flow-root" }}>
      {children}
    </div>
  );
}
