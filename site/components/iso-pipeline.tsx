import { box, floor, projector, type Face } from "@/components/iso";

/*
 * "The usual way" vs "with Truecanvas" as small isometric scenes. The usual
 * way: four blocks, the last one drifting off the line with a broken link.
 * Truecanvas: your components, the canvas (the T) and the pull request on
 * one flowing line.
 */

const { iso, path } = projector(150, 66);

const PAPER = { top: "#ffffff", x: "#e9e3da", y: "#f3efe9" };
const CORAL = { top: "#f2774a", x: "#b8461f", y: "#d85d31" };
const RED = { top: "#fee2e2", x: "#f2b8b8", y: "#f9d0d0" };

interface Block {
  x: number;
  y: number;
  s: number;
  h: number;
  colors: typeof PAPER;
  label: string;
}

function Scene({ id, blocks, links, broken }: { id: string; blocks: Block[]; links: [number, number][]; broken?: number }) {
  const faces: (Face & { key: string })[] = blocks
    .flatMap((b, i) => box(path, b.x, b.y, b.s, b.s, b.h, b.colors).map((f, j) => ({ ...f, key: `${i}-${j}` })))
    .sort((a, b) => a.depth - b.depth);
  const mid = (b: Block) => [b.x + b.s / 2, b.y + b.s / 2, 0] as [number, number, number];
  const grid = floor(path, 160, 32);
  return (
    <svg viewBox="0 0 300 150" className="h-auto w-full overflow-visible" aria-hidden>
      <defs>
        <radialGradient id={`${id}-fade`} cx="50%" cy="45%" r="55%">
          <stop offset="0" stopColor="#fff" stopOpacity="1" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
        <mask id={`${id}-mask`}>
          <rect width="300" height="150" fill={`url(#${id}-fade)`} />
        </mask>
      </defs>
      <g mask={`url(#${id}-mask)`} stroke="#1c1917" strokeOpacity="0.08">
        {grid.map((g, i) => (
          <path key={i} d={g} />
        ))}
      </g>
      <g fill="none" strokeWidth="1.25" strokeDasharray="3 6" strokeLinecap="round">
        {links.map(([a, b], i) => (
          <path
            key={i}
            d={path([mid(blocks[a]), mid(blocks[b])], false)}
            stroke={broken === i ? "#dc2626" : blocks[b].colors === CORAL || blocks[a].colors === CORAL ? "#f2774a" : "#a8a29e"}
            strokeOpacity={broken === i ? 0.7 : 0.9}
            style={broken === i ? undefined : { animation: `iso-dash ${2.4 + i * 0.4}s linear infinite` }}
          />
        ))}
      </g>
      {broken !== undefined &&
        (() => {
          const [a, b] = links[broken];
          const m = mid(blocks[a]);
          const n = mid(blocks[b]);
          const [cx, cy] = iso([(m[0] + n[0]) / 2, (m[1] + n[1]) / 2, 0]);
          return (
            <g stroke="#dc2626" strokeWidth="1.6" strokeLinecap="round">
              <path d={`M${cx - 4} ${cy - 4} L${cx + 4} ${cy + 4} M${cx + 4} ${cy - 4} L${cx - 4} ${cy + 4}`} />
            </g>
          );
        })()}
      <g strokeLinejoin="round" className="iso-rise">
        {faces.map((f) => (
          <path key={f.key} d={f.d} fill={f.fill} stroke="#1c1917" strokeOpacity="0.45" strokeWidth="1" />
        ))}
      </g>
      {blocks
        .filter((b) => b.colors === CORAL)
        .map((b, i) => {
          const [cx, cy] = iso([b.x + b.s / 2, b.y + b.s / 2, b.h]);
          const k = 0.5;
          return (
            <path
              key={i}
              className="iso-rise"
              fill="#fff"
              fillRule="evenodd"
              transform={`translate(${cx.toFixed(1)} ${cy.toFixed(1)}) matrix(${(0.866 * k).toFixed(3)} ${(0.5 * k).toFixed(3)} ${(-0.866 * k).toFixed(3)} ${(0.5 * k).toFixed(3)} 0 0) translate(-32 -32)`}
              d="M4 5h56v18H4z M22 14h20v46H22z"
            />
          );
        })}
      <g fontFamily="var(--font-geist-mono), monospace" fontSize="9" fill="#78716c" textAnchor="middle">
        {blocks.map((b, i) => {
          const [lx, ly] = iso([b.x + b.s, b.y + b.s, 0]);
          return (
            <text key={i} x={lx.toFixed(1)} y={(ly + 13).toFixed(1)}>
              {b.label}
            </text>
          );
        })}
      </g>
    </svg>
  );
}

/** The usual pipeline, or Truecanvas's. */
export function IsoPipeline({ variant = "old" }: { variant?: "old" | "new" }) {
  if (variant === "old") {
    const blocks: Block[] = [
      { x: -120, y: -22, s: 34, h: 10, colors: PAPER, label: "Mockup" },
      { x: -55, y: -22, s: 34, h: 10, colors: PAPER, label: "Handoff" },
      { x: 10, y: -22, s: 34, h: 10, colors: PAPER, label: "Code" },
      { x: 82, y: -2, s: 34, h: 10, colors: RED, label: "Drift" },
    ];
    return <Scene id="pipe-old" blocks={blocks} links={[[0, 1], [1, 2], [2, 3]]} broken={2} />;
  }
  const blocks: Block[] = [
    { x: -110, y: -18, s: 34, h: 10, colors: PAPER, label: "Components" },
    { x: -28, y: -28, s: 54, h: 18, colors: CORAL, label: "Canvas" },
    { x: 70, y: -18, s: 34, h: 10, colors: PAPER, label: "Pull request" },
  ];
  return <Scene id="pipe-new" blocks={blocks} links={[[0, 1], [1, 2]]} />;
}
