import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import { ShotStage, type ShotImage } from "./ShotStage";
import type { Shot } from "../../../src/core/shot-model";

/*
 * The export page: the server opens /shot.html?job=<id> in its screenshot
 * browser at the format's size, waits for `__shotReady`, and saves the pixels.
 */

declare global {
  interface Window {
    __shotReady?: boolean;
    __shotError?: string;
  }
}

function ShotPage() {
  const [job, setJob] = useState<{ shot: Shot; image: ShotImage } | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("job") ?? "";
    fetch(`/api/shot/job?id=${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`job ${r.status}`))))
      .then(setJob)
      .catch((e: Error) => (window.__shotError = e.message));
  }, []);
  if (!job) return null;
  return <ShotStage shot={job.shot} image={job.image} onReady={() => (window.__shotReady = true)} />;
}

createRoot(document.getElementById("root")!).render(<ShotPage />);
