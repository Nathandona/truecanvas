/* One frame on the canvas: the app page in an iframe, its device chrome, and its loading state. */
import type { Override } from "./canvasShared";
import { memo, useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useStore, effectiveTheme, layerKey } from "../lib/store";
import { refreshRects, registerFrame, send, forgetFrameReady } from "../lib/bridge";
import { playHeight } from "../lib/actions";
import { findDevice, type CanvasFrame, type Device } from "../lib/api";
import { rawId } from "../lib/scope";

export const FrameView = memo(function FrameView({ frame, x: posX, y: posY, width: posW, height: posH, mounted, interactive }: { frame: CanvasFrame; mounted: boolean; interactive: boolean } & Override) {
  const pos: Override = { x: posX, y: posY, width: posW, height: posH };
  const appUrl = useStore((s) => s.appUrl);
  const canvas = useStore((s) => s.canvas);
  const canvasTheme = useStore((s) => s.canvasTheme);
  const measured = useStore((s) => s.frameHeights[frame.frameName]);
  const ready = useStore((s) => s.frameReady[frame.frameName]);
  const error = useStore((s) => s.frameErrors[frame.frameName]);
  const appStatus = useStore((s) => s.appStatus);
  const theme = effectiveTheme(frame, canvasTheme);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  // stable: an inline ref callback runs with null then the element on every render
  const iframeCallback = useCallback(
    (el: HTMLIFrameElement | null) => {
      iframeRef.current = el;
      registerFrame(frame.frameName, el);
    },
    [frame.frameName],
  );
  // the iframe really unmounting (not a re-render): it'll need to say "ready" again
  const live = mounted && appStatus !== "down";
  useEffect(() => {
    if (!live) return;
    return () => forgetFrameReady(frame.frameName);
  }, [live, frame.frameName]);
  // the theme in the URL only matters for the first paint; later changes are sent as messages
  const initialTheme = useRef(theme);
  const src = useMemo(
    () =>
      `${appUrl}/truecanvas/${encodeURIComponent(canvas ?? "")}?frame=${encodeURIComponent(frame.frameName)}&theme=${initialTheme.current}&editor=${encodeURIComponent(location.origin)}`,
    [appUrl, canvas, frame.frameName],
  );
  const motionPaused = useStore((s) => s.motionPaused);
  const deviceChrome = useStore((s) => s.deviceChrome);
  const playing = useStore((s) => s.playing === frame.frameName);
  const wasPlaying = useRef(false);
  useEffect(() => {
    if (!ready || wasPlaying.current === playing) return;
    wasPlaying.current = playing;
    send(frame.frameName, { type: "tc:play", on: playing });
  }, [playing, ready, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:theme", theme });
  }, [theme, ready, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:motion", paused: motionPaused });
  }, [motionPaused, ready, frame.frameName]);
  const hiddenKeys = useStore((s) => s.hidden);
  const index = useStore((s) => s.index);
  const hiddenIds = useMemo(() => {
    const ids: string[] = [];
    for (const [id, e] of index) if (e.frame.frameName === frame.frameName && id !== e.frame.id && hiddenKeys.has(layerKey(e.node))) ids.push(id);
    return ids.sort().join(",");
  }, [hiddenKeys, index, frame.frameName]);
  useEffect(() => {
    if (ready) send(frame.frameName, { type: "tc:hidden", ids: hiddenIds ? hiddenIds.split(",").map(rawId) : [] });
  }, [hiddenIds, ready, frame.frameName]);
  const device = findDevice(frame.device);
  const chrome = deviceChrome && device && device.kind !== "desktop" ? device : null;

  const height = pos.height ?? (playing ? playHeight(frame) : (measured ?? 360));
  // ready and at its real size: until then the page stays hidden under the shimmer
  // (an error, or a page that never reports its height, shows anyway after a moment)
  const [late, setLate] = useState(false);
  useEffect(() => {
    setLate(false);
    if (!ready) return;
    const t = setTimeout(() => setLate(true), 2000);
    return () => clearTimeout(t);
  }, [ready]);
  const settled = mounted && ready && (frame.height !== null || measured !== undefined || !!error || late);
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <div
      className={`frame-box${dark ? " dark" : ""}${chrome ? " device" : ""}${playing ? " playing" : ""}`}
      style={{ left: pos.x, top: pos.y, width: pos.width, height, borderRadius: chrome ? chrome.radius : undefined }}
    >
      {live && (
        <iframe
          ref={iframeCallback}
          title={frame.frameName}
          src={src}
          style={{ pointerEvents: interactive || playing ? "auto" : "none", opacity: settled ? 1 : 0, transition: "opacity 0.25s ease" }}
          onLoad={() => setTimeout(() => void refreshRects(new Set([frame.frameName])), 50)}
        />
      )}
      {chrome && <DeviceChrome device={chrome} dark={dark} />}
      {/* fades out once the page is ready and has its real height, so nothing jumps */}
      <div className={`placeholder${settled ? " gone" : ""}`} aria-hidden>
        {appStatus === "down" ? "Waiting for the app…" : ""}
      </div>
      {error && (
        <div className="frame-error">
          <strong>Render error · </strong>
          {error}
        </div>
      )}
    </div>
  );
});

/** Status bar, dynamic island and home indicator, drawn over the frame (not part of your app). */
function DeviceChrome({ device, dark }: { device: Device; dark: boolean }) {
  const ink = dark ? "#fff" : "#000";
  return (
    <div className="device-chrome" aria-hidden>
      {device.statusBar > 0 && (
        <div className="status-bar" style={{ height: device.statusBar, color: ink, padding: device.island ? "0 32px 0 46px" : "0 20px" }}>
          <span className="time">9:41</span>
          {device.island && <span className="island" />}
          <span className="icons">
            <svg width="18" height="11" viewBox="0 0 18 11" fill={ink}>
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="5" y="5" width="3" height="6" rx="1" />
              <rect x="10" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="15" y="0" width="3" height="11" rx="1" />
            </svg>
            <svg width="16" height="11" viewBox="0 0 16 11" fill={ink}>
              <path d="M8 2.2c2.3 0 4.4.9 6 2.4l1.1-1.2A10.2 10.2 0 0 0 8 .5C5.3.5 2.8 1.5.9 3.4L2 4.6a8.6 8.6 0 0 1 6-2.4zm0 3.3c1.4 0 2.6.5 3.6 1.4l1.1-1.2A7 7 0 0 0 8 3.8a7 7 0 0 0-4.7 1.9l1.1 1.2c1-.9 2.2-1.4 3.6-1.4zm0 3.3c.5 0 1 .2 1.3.5L8 10.8 6.7 9.3c.3-.3.8-.5 1.3-.5z" />
            </svg>
            <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
              <rect x=".5" y=".5" width="22" height="11" rx="3.5" stroke={ink} strokeOpacity=".4" />
              <rect x="2" y="2" width="19" height="8" rx="2" fill={ink} />
              <path d="M24 4v4c.8-.3 1.3-1.1 1.3-2S24.8 4.3 24 4z" fill={ink} fillOpacity=".5" />
            </svg>
          </span>
        </div>
      )}
      {device.homeIndicator > 0 && (
        <div className="home-indicator" style={{ height: device.homeIndicator }}>
          <span style={{ background: ink, width: device.kind === "tablet" ? 300 : 134 }} />
        </div>
      )}
    </div>
  );
}
