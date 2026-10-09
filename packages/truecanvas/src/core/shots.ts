import fs from "node:fs";
import path from "node:path";
import type { TruecanvasConfig } from "./config.js";
import { assertCanvasName } from "./scaffold.js";
import { normalizeShot, type Shot } from "./shot-model.js";

/**
 * A canvas's shots, in `<page>.shots.json` next to it: versioned with the
 * repo, readable and editable by agents, regenerated after design changes.
 */
export class Shots {
  constructor(private config: TruecanvasConfig) {}

  file(canvas: string) {
    return path.join(this.config.root, this.config.canvasDir, `${assertCanvasName(canvas)}.shots.json`);
  }

  list(canvas: string): Shot[] {
    try {
      const f = JSON.parse(fs.readFileSync(this.file(canvas), "utf8")) as { shots?: unknown[] };
      return (f.shots ?? []).map(normalizeShot);
    } catch {
      return [];
    }
  }

  get(canvas: string, id: string): Shot | null {
    return this.list(canvas).find((s) => s.id === id) ?? null;
  }

  /** Adds or replaces a shot (by id); the newest first. */
  save(canvas: string, input: unknown): Shot {
    const shot = { ...normalizeShot(input), updatedAt: Date.now() };
    const shots = [shot, ...this.list(canvas).filter((s) => s.id !== shot.id)];
    this.write(canvas, shots);
    return shot;
  }

  remove(canvas: string, id: string): boolean {
    const shots = this.list(canvas);
    const left = shots.filter((s) => s.id !== id);
    if (left.length === shots.length) return false;
    this.write(canvas, left);
    return true;
  }

  private write(canvas: string, shots: Shot[]) {
    const file = this.file(canvas);
    if (!shots.length) {
      fs.rmSync(file, { force: true });
      return;
    }
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, shots }, null, 2)}\n`);
  }
}
