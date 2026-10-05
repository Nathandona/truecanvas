import { extrude, floor, projector } from "@/components/iso";

/*
 * The Truecanvas T, extruded in isometric (like Altair Studio's closing
 * scene): coral faces, a soft halo and a slow bob. CSS motion only.
 */

const { iso, path } = projector(160, 92);

// the T lying on the floor, centered on the origin
const T: [number, number][] = [
  [-60, -58],
  [60, -58],
  [60, -24],
  [17, -24],
  [17, 64],
  [-17, 64],
  [-17, -24],
  [-60, -24],
];

export function IsoMark({ className = "", tone = "dark" }: { className?: string; tone?: "dark" | "light" }) {
  const faces = extrude(path, T, 30, { top: "#f2774a", x: "#b8461f", y: "#d85d31" });
  const grid = floor(path, 200, 40);
  const [hx, hy] = iso([0, 0, 0]);
  const ink = tone === "dark" ? "#ffffff" : "#1c1917";
  return (
    <svg viewBox="0 0 320 230" className={`h-auto w-full overflow-visible ${className}`} aria-hidden>
      <defs>
        <radialGradient id="mark-fade" cx="50%" cy="48%" r="50%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id="mark-mask">
          <rect width="320" height="230" fill="url(#mark-fade)" />
        </mask>
      </defs>
      <g mask="url(#mark-mask)" stroke={ink} strokeOpacity="0.12" strokeWidth="1">
        {grid.map((g, i) => (
          <path key={i} d={g} />
        ))}
      </g>
      <ellipse cx={hx} cy={hy + 8} rx="104" ry="52" fill="#f2774a" opacity="0.18" className="iso-halo" />
      <g className="iso-rise">
        <g className="iso-bob" strokeLinejoin="round">
          {faces.map((f, i) => (
            <path key={i} d={f.d} fill={f.fill} stroke="#7c2d12" strokeOpacity="0.55" strokeWidth="1" />
          ))}
        </g>
      </g>
    </svg>
  );
}
