import type http from "node:http";
import { EditError } from "../core/edit.js";

/** A request's JSON body. Too large or malformed bodies are the client's fault (400), not a server error. */
export async function readJson(req: http.IncomingMessage, limit = 8 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > limit) throw new EditError("Request too large.");
    chunks.push(chunk as Buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new EditError("The request body isn't valid JSON.");
  }
}
