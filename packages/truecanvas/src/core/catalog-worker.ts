import { parentPort, workerData } from "node:worker_threads";
import { analyzeComponents } from "./catalog.js";

analyzeComponents(workerData.root, workerData.globs, workerData.libraries)
  .then((list) => parentPort!.postMessage({ ok: true, list }))
  .catch((err) => parentPort!.postMessage({ ok: false, error: (err as Error).message }));
