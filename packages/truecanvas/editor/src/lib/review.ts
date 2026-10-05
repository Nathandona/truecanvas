import type { PageReview } from "./api";

const lc = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

/** Unique change labels of a frame, in order (repeated nudges of the same prop count once). */
export function frameLabels(changes: { label: string }[]): string[] {
  const out: string[] = [];
  for (const c of changes) if (!out.includes(c.label) && !/^(Undid|Redid) /.test(c.label)) out.push(c.label);
  return out;
}

/**
 * A commit message from what changed: "Home: remove Companies, add a reveal"
 * for one frame; "Update Home, Pricing" with one line per frame otherwise.
 */
export function draftMessage(pages: PageReview[]): string {
  const frames = pages.flatMap((p) => p.frames.map((f) => ({ page: p.canvas, ...f, labels: frameLabels(f.changes) })));
  if (!frames.length) return "";
  const summary = (f: (typeof frames)[number]) => {
    if (f.status === "added") return `add ${f.name}`;
    if (f.status === "removed") return `remove ${f.name}`;
    if (!f.labels.length) return `update ${f.name}`;
    const shown = f.labels.slice(0, 3).map(lc).join(", ");
    return f.labels.length > 3 ? `${shown} and ${f.labels.length - 3} more` : shown;
  };
  if (frames.length === 1) {
    const f = frames[0];
    if (f.status !== "changed") return capitalize(summary(f));
    return `${f.name}: ${summary(f)}`;
  }
  const title = `Update ${[...new Set(frames.map((f) => f.name))].slice(0, 3).join(", ")}${frames.length > 3 ? ` and ${frames.length - 3} more` : ""}`;
  const body = frames.map((f) => `- ${f.name}: ${summary(f)}`);
  return `${title}\n\n${body.join("\n")}`;
}

const capitalize = (s: string) => s[0].toUpperCase() + s.slice(1);

const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** A branch name for the current changes, from the page and its changed frames: design/home-pricing. */
export function suggestBranch(pages: PageReview[], canvas: string | null): string {
  const page = pages.find((p) => p.canvas === canvas) ?? pages[0];
  const frames = (page?.frames ?? []).slice(0, 2).map((f) => slug(f.name));
  const parts = [slug(page?.canvas ?? canvas ?? ""), ...frames].filter((p, i, all) => p && all.indexOf(p) === i);
  return `design/${parts.join("-").slice(0, 40).replace(/-$/, "") || "changes"}`;
}

/** First line of a message: a PR title. */
export const titleOf = (message: string) => message.split("\n")[0].trim();
