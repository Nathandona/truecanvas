import { Reveal } from "@/components/motion/reveal";

/*
 * The pull request description Truecanvas writes (prDesignSection), shown the
 * way GitHub renders it: a section per frame, before and after renders, and
 * the change list in plain words.
 */

function MiniHero({ after }: { after?: boolean }) {
  return (
    <div className={`flex aspect-[4/3] flex-col items-center justify-center gap-[3cqw] px-[6cqw] text-center ${after ? "bg-[radial-gradient(circle_at_50%_0%,#fde3d6,transparent_70%)] bg-paper" : "bg-white"}`}>
      {after && <span className="rounded-full bg-white px-[2.5cqw] py-[0.5cqw] text-[3.6cqw] text-muted ring-1 ring-line">Open source</span>}
      <span className={after ? "text-[9cqw] leading-[1.05] font-semibold tracking-tight text-balance" : "text-[6.5cqw] font-medium text-ink-2"}>
        {after ? "Design with your real components" : "Design in the browser"}
      </span>
      <span className="max-w-[85%] text-[3.6cqw] leading-snug text-muted">A Figma-like canvas for your React app. Every layer is your code.</span>
      <span className={`mt-[1cqw] rounded px-[3cqw] py-[1.2cqw] text-[3.6cqw] font-medium ${after ? "rounded-full bg-ink text-white" : "bg-paper-2 text-ink-2"}`}>Get started</span>
    </div>
  );
}

const facts = [
  ["Canvases are .tsx files.", "Frames, comments and linked pages live in canvas/ next to your code, so they branch and merge like everything else."],
  ["Commit and open the PR from the canvas.", "It renders every changed frame before and after, and writes the description for you."],
  ["Reviewers open the PR in Truecanvas.", "One click checks out the branch and shows the real thing, not an export of it."],
];

export function Collaborate() {
  return (
    <section id="collaborate" className="px-6 py-28">
      <div className="mx-auto grid max-w-6xl gap-14 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Reveal stagger={0.1} className="flex flex-col gap-10 md:sticky md:top-28 md:self-start">
          <h2 className="text-4xl font-semibold tracking-tight text-balance">Design review happens in the pull request.</h2>
          <dl className="flex flex-col gap-6 text-[15px] leading-relaxed">
            {facts.map(([title, body]) => (
              <div key={title} className="border-l border-line pl-4">
                <dt className="font-semibold text-ink">{title}</dt>
                <dd className="text-muted">{body}</dd>
              </div>
            ))}
          </dl>
          <a href="https://github.com/Nathandona/truecanvas#collaborate" className="group inline-flex items-center gap-1.5 self-start text-[14px] font-medium text-ink-2 hover:text-ink">
            How teams work with Truecanvas <span aria-hidden className="transition-transform duration-200 group-hover:translate-x-0.5">→</span>
          </a>
        </Reveal>

        <Reveal delay={0.15} duration={0.7}>
        <div className="overflow-hidden rounded-xl bg-white text-[13.5px] ring-1 ring-line shadow-[0_24px_60px_-30px_rgb(28_25_23/0.3)]">
          <div className="border-b border-line px-5 py-4">
            <div className="text-[18px] font-semibold tracking-tight">
              Home: restyle the hero, add a reveal <span className="font-normal text-muted">#42</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
              <span className="inline-flex items-center gap-1 rounded-full bg-[#1f883d] px-2.5 py-1 font-medium text-white">
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
                  <path d="M1.5 3.25a2.25 2.25 0 1 1 3 2.12v5.26a2.25 2.25 0 1 1-1.5 0V5.37A2.25 2.25 0 0 1 1.5 3.25Zm5.68-.53L9.06.84a.25.25 0 0 1 .44.17V2.5h1.25A2.75 2.75 0 0 1 13.5 5.25v5.38a2.25 2.25 0 1 1-1.5 0V5.25c0-.69-.56-1.25-1.25-1.25H9.5v1.49a.25.25 0 0 1-.44.17L7.18 3.78a.75.75 0 0 1 0-1.06Z" />
                </svg>
                Open
              </span>
              <span>
                <span className="font-medium text-ink-2">ines</span> wants to merge into <span className="rounded bg-[#ddf4ff] px-1.5 py-0.5 font-mono text-[11.5px] text-[#0969da]">main</span> from{" "}
                <span className="rounded bg-[#ddf4ff] px-1.5 py-0.5 font-mono text-[11.5px] text-[#0969da]">design/home-hero</span>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3 px-5 py-5">
            <h3 className="border-b border-line pb-1.5 text-[17px] font-semibold">Design changes</h3>
            <p className="text-muted italic">Made in Truecanvas.</p>
            <h4 className="mt-1 text-[14.5px] font-semibold">
              Home <code className="rounded bg-paper-2 px-1.5 py-0.5 font-mono text-[12px] font-normal">home</code>
            </h4>
            <table className="w-full table-fixed border-collapse text-left text-[12.5px]">
              <thead>
                <tr>
                  <th className="border border-line bg-paper/60 px-3 py-1.5 font-semibold">Before</th>
                  <th className="border border-line bg-paper/60 px-3 py-1.5 font-semibold">After</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-line p-2">
                    <div className="@container overflow-hidden rounded ring-1 ring-line">
                      <MiniHero />
                    </div>
                  </td>
                  <td className="border border-line p-2">
                    <div className="@container overflow-hidden rounded ring-1 ring-line">
                      <MiniHero after />
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
            <ul className="ml-5 list-disc text-ink-2 marker:text-muted">
              <li>Changed h1 text to “Design with your real components”</li>
              <li>Restyled h1 (+text-6xl +tracking-tight -text-5xl)</li>
              <li>Set variant to primary on Button</li>
              <li>
                Added a fade-up reveal to Features <em className="text-muted">(claude)</em>
              </li>
            </ul>
          </div>

          <div className="flex items-center gap-2 border-t border-line bg-paper/60 px-5 py-3 text-[12.5px] text-muted">
            <span className="size-2 rounded-full bg-[#1f883d]" />
            All checks have passed
            <span className="ml-auto font-mono text-[11.5px]">3 files changed</span>
          </div>
        </div>
        </Reveal>
      </div>
    </section>
  );
}
