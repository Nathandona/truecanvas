import path from "node:path";

/** A path with forward slashes: ids, import specifiers and keys read the same on every OS (a no-op off Windows). */
export const posix = (p: string) => p.split(path.sep).join("/");
