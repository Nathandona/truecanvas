import { BRANDS, type BrandName } from "@/components/brand-logo";

/*
 * Isometric scene: Truecanvas in the middle of your stack and your agents.
 * Plain SVG with a 2:1 isometric projection, shaded faces drawn back to
 * front, dashed links that flow, and tiles that rise in. No dependencies:
 * the motion is CSS keyframes (see globals.css).
 */

type P3 = [number, number, number];
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);
const OX = 300;
const OY = 150;

const iso = ([x, y, z]: P3): [number, number] => [OX + (x - y) * COS, OY + (x + y) * SIN - z];
const d = (pts: P3[]) => `${pts.map((p, i) => `${i ? "L" : "M"}${iso(p)[0].toFixed(1)} ${iso(p)[1].toFixed(1)}`).join(" ")} Z`;
const line = (a: P3, b: P3) => `M${iso(a)[0].toFixed(1)} ${iso(a)[1].toFixed(1)} L${iso(b)[0].toFixed(1)} ${iso(b)[1].toFixed(1)}`;

interface Tile {
  key: string;
  x: number;
  y: number;
  size: number;
  h: number;
  brand?: BrandName;
  label: string;
}

const S = 54;
const TILES: Tile[] = [
  { key: "next", brand: "next", label: "Next.js", x: -175, y: -60, size: S, h: 12 },
  { key: "react", brand: "react", label: "React", x: -150, y: 70, size: S, h: 12 },
  { key: "tailwind", brand: "tailwind", label: "Tailwind", x: -60, y: -175, size: S, h: 12 },
  { key: "typescript", brand: "typescript", label: "TypeScript", x: 60, y: -160, size: S, h: 12 },
  { key: "claude", brand: "claude", label: "Claude Code", x: 130, y: -40, size: S, h: 12 },
  { key: "cursor", brand: "cursor", label: "Cursor", x: 110, y: 95, size: S, h: 12 },
  { key: "github", brand: "github", label: "GitHub", x: -15, y: 140, size: S, h: 12 },
];
const CENTER: Tile = { key: "truecanvas", label: "Truecanvas", x: -44, y: -44, size: 88, h: 26 };

/** A box's visible faces (top, +x, +y), shaded like light from above-left. */
function Box({ t, dark = false }: { t: Tile; dark?: boolean }) {
  const { x, y, size: s, h } = t;
  const X = x + s;
  const Y = y + s;
  const top = d([[x, y, h], [X, y, h], [X, Y, h], [x, Y, h]]);
  const right = d([[X, y, 0], [X, Y, 0], [X, Y, h], [X, y, h]]);
  const front = d([[x, Y, 0], [X, Y, 0], [X, Y, h], [x, Y, h]]);
  const [topFill, rightFill, frontFill, stroke] = dark ? ["#1c1917", "#2b2622", "#36302b", "#0c0a09"] : ["#ffffff", "#ece6dd", "#f4f0ea", "#1c1917"];
  return (
    <g strokeLinejoin="round" strokeWidth="1">
      <path d={right} fill={rightFill} stroke={stroke} strokeOpacity={dark ? 1 : 0.55} />
      <path d={front} fill={frontFill} stroke={stroke} strokeOpacity={dark ? 1 : 0.55} />
      <path d={top} fill={topFill} stroke={stroke} strokeOpacity={dark ? 1 : 0.55} />
    </g>
  );
}

/** Lays a 24×24 graphic flat on a tile's top face. */
function OnTop({ t, scale, children }: { t: Tile; scale: number; children: React.ReactNode }) {
  const [cx, cy] = iso([t.x + t.size / 2, t.y + t.size / 2, t.h]);
  return (
    <g transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) matrix(${(COS * scale).toFixed(3)} ${(SIN * scale).toFixed(3)} ${(-COS * scale).toFixed(3)} ${(SIN * scale).toFixed(3)} 0 0) translate(-12 -12)`}>
      {children}
    </g>
  );
}

export function IsoStack({ className = "" }: { className?: string }) {
  // back to front
  const tiles = [...TILES, CENTER].sort((a, b) => a.x + a.y + a.size - (b.x + b.y + b.size));
  const mid = (t: Tile): P3 => [t.x + t.size / 2, t.y + t.size / 2, 0];
  const grid: string[] = [];
  for (let k = -6; k <= 6; k++) {
    grid.push(line([k * 40, -260, 0], [k * 40, 260, 0]));
    grid.push(line([-260, k * 40, 0], [260, k * 40, 0]));
  }
  return (
    <svg viewBox="0 0 600 380" className={`h-auto w-full overflow-visible ${className}`} role="img" aria-label="Truecanvas connects your stack (Next.js, React, Tailwind, TypeScript, GitHub) and your agents (Claude Code, Cursor)">
      <defs>
        <radialGradient id="iso-fade" cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="0.55" stopColor="#fff" stopOpacity="0.45" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="iso-grid-mask">
          <rect width="600" height="380" fill="url(#iso-fade)" />
        </mask>
      </defs>

      {/* floor */}
      <g mask="url(#iso-grid-mask)" stroke="#1c1917" strokeOpacity="0.09" strokeWidth="1">
        {grid.map((g, i) => (
          <path key={i} d={g} />
        ))}
      </g>

      {/* the halo under Truecanvas */}
      <ellipse cx={iso(mid(CENTER))[0]} cy={iso(mid(CENTER))[1] + 6} rx="92" ry="46" fill="#f2774a" opacity="0.12" className="iso-halo" />

      {/* links to the center, flowing */}
      <g fill="none" stroke="#f2774a" strokeWidth="1.25" strokeDasharray="3 7" strokeLinecap="round">
        {TILES.map((t, i) => (
          <path key={t.key} d={line(mid(t), mid(CENTER))} strokeOpacity="0.7" style={{ animation: `iso-dash ${2.2 + (i % 3) * 0.5}s linear infinite` }} />
        ))}
      </g>

      {/* tiles */}
      {tiles.map((t, i) => {
        const center = t === CENTER;
        return (
          <g key={t.key} className="iso-rise" style={{ animationDelay: `${center ? 0 : 0.15 + i * 0.07}s` }}>
            <g className={center ? "iso-bob" : undefined}>
              <Box t={t} dark={center} />
              {center ? (
                <OnTop t={t} scale={2.05}>
                  <path fill="#f2774a" fillRule="evenodd" transform="scale(0.375)" d="M4 5h56v18H4z M22 14h20v46H22z" />
                </OnTop>
              ) : (
                <OnTop t={t} scale={1.25}>
                  <path d={BRANDS[t.brand!].path} fill={t.brand === "next" || t.brand === "cursor" || t.brand === "github" ? "#1c1917" : BRANDS[t.brand!].color} />
                </OnTop>
              )}
            </g>
          </g>
        );
      })}

      {/* labels under the tiles, in screen space */}
      <g fontFamily="var(--font-geist-mono), monospace" fontSize="10" fill="#78716c" textAnchor="middle">
        {TILES.map((t) => {
          const [lx, ly] = iso([t.x + t.size, t.y + t.size, 0]);
          return (
            <text key={t.key} x={lx.toFixed(1)} y={(ly + 16).toFixed(1)}>
              {t.label}
            </text>
          );
        })}
      </g>

    </svg>
  );
}
