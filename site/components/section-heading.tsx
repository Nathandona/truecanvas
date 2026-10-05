/** Eyebrow, title and intro of a section. */
export function SectionHeading({
  eyebrow = "Section",
  title = "A clear section title",
  description,
  align = "center",
}: {
  eyebrow?: string;
  title?: string;
  description?: string;
  align?: "center" | "left";
}) {
  return (
    <div className={`flex max-w-2xl flex-col gap-4 ${align === "center" ? "mx-auto items-center text-center" : ""}`}>
      <span className="font-mono text-[12px] uppercase tracking-[0.14em] text-coral-ink">{eyebrow}</span>
      <h2 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">{title}</h2>
      {description && <p className="text-[17px] leading-relaxed text-muted text-pretty">{description}</p>}
    </div>
  );
}
