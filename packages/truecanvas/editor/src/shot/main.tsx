import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { ShotStage, type ShotImage, type ShotLive } from "./ShotStage";
import type { Shot } from "../../../src/core/shot-model";

/*
 * The export page: the server opens /shot.html?job=<id> in its screenshot
 * browser at the format's size and waits for `__shotReady`. An image is
 * saved once; a video is recorded frame by frame, the server setting the
 * time with `__tcSetTime` before each screenshot.
 */

declare global {
  interface Window {
    __shotReady?: boolean;
    __shotError?: string;
    __tcSetTime?: (t: number) => void;
  }
}

function ShotPage() {
  const [job, setJob] = useState<{ shot: Shot; image?: ShotImage; live?: ShotLive } | null>(null);
  const [time, setTime] = useState(0);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("job") ?? "";
    fetch(`/api/shot/job?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`job ${r.status}`))))
      .then(setJob)
      .catch((e: Error) => (window.__shotError = e.message));
    // synchronous: the next screenshot shows this time
    window.__tcSetTime = (t) => flushSync(() => setTime(t));
  }, []);
  if (!job) return null;
  return <ShotStage shot={job.shot} image={job.image ?? null} live={job.live} time={time} onReady={() => (window.__shotReady = true)} />;
}

createRoot(document.getElementById("root")!).render(<ShotPage />);
