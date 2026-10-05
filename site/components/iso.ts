/*
 * Isometric helpers shared by the scenes (Altair Studio's technique): a 2:1
 * projection, boxes and extruded shapes as faces, drawn back to front.
 */

export type P3 = [number, number, number];
export interface Face {
  d: string;
  fill: string;
  depth: number;
}

const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

/** A projector with its own origin on the SVG canvas. */
export function projector(ox: number, oy: number) {
  const iso = ([x, y, z]: P3): [number, number] => [ox + (x - y) * COS, oy + (x + y) * SIN - z];
  const path = (pts: P3[], close = true) => `${pts.map((p, i) => `${i ? "L" : "M"}${iso(p)[0].toFixed(1)} ${iso(p)[1].toFixed(1)}`).join(" ")}${close ? " Z" : ""}`;
  return { iso, path };
}

/** Faces seen from the front-right: the top and the +x / +y sides. */
export function box(path: (p: P3[]) => string, x: number, y: number, w: number, d: number, h: number, colors: { top: string; x: string; y: string }, z = 0): Face[] {
  const X = x + w;
  const Y = y + d;
  const Z = z + h;
  return [
    { d: path([[X, y, z], [X, Y, z], [X, Y, Z], [X, y, Z]]), fill: colors.x, depth: X + y + z },
    { d: path([[x, Y, z], [X, Y, z], [X, Y, Z], [x, Y, Z]]), fill: colors.y, depth: x + Y + z },
    { d: path([[x, y, Z], [X, y, Z], [X, Y, Z], [x, Y, Z]]), fill: colors.top, depth: x + y + Z + w + d },
  ];
}

/** A flat polygon (on the floor) extruded upward: visible sides, then the top. */
export function extrude(path: (p: P3[]) => string, poly: [number, number][], h: number, colors: { top: string; x: string; y: string }, z = 0): Face[] {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    area += x1 * y2 - x2 * y1;
  }
  const faces: Face[] = [];
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const [dx, dy] = [x2 - x1, y2 - y1];
    // outward normal of the edge
    const [nx, ny] = area > 0 ? [dy, -dx] : [-dy, dx];
    if (nx + ny <= 0) continue; // faces away from the viewer
    faces.push({
      d: path([[x1, y1, z], [x2, y2, z], [x2, y2, z + h], [x1, y1, z + h]]),
      fill: Math.abs(nx) > Math.abs(ny) ? colors.x : colors.y,
      depth: (x1 + x2 + y1 + y2) / 2,
    });
  }
  faces.sort((a, b) => a.depth - b.depth);
  faces.push({ d: path(poly.map(([x, y]) => [x, y, z + h] as P3)), fill: colors.top, depth: Infinity });
  return faces;
}

/** Floor grid lines, to be masked into a soft fade. */
export function floor(path: (p: P3[], close?: boolean) => string, half = 240, step = 40): string[] {
  const out: string[] = [];
  for (let k = -half; k <= half; k += step) {
    out.push(path([[k, -half, 0], [k, half, 0]], false));
    out.push(path([[-half, k, 0], [half, k, 0]], false));
  }
  return out;
}
