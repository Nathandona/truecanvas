import { parentPort, workerData } from "node:worker_threads";
import { renderIconSet } from "./icons.js";

renderIconSet(workerData.root, workerData.id)
  .then((icons) => parentPort!.postMessage({ ok: true, icons }))
  .catch((err) => parentPort!.postMessage({ ok: false, error: (err as Error).message }));
