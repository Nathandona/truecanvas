import { brand } from "@/lib/http";

/** Nothing to browse here: every design has its own private link. */
export default function Home() {
  const b = brand();
  return (
    <main style={{ minHeight: "100dvh", display: "grid", placeItems: "center", padding: 16, background: "#f3f2ef", color: "#1c1b19" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, fontWeight: 600 }}>
        {b.logo && <img alt="" src={b.logo} style={{ height: 24 }} />}
        <span>{b.name}</span>
      </div>
    </main>
  );
}
