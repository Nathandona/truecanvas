import { Logo } from "@/components/logo";
import { BrandLogo } from "@/components/brand-logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-line/70 bg-paper/80 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <a href="/">
          <Logo />
        </a>
        <div className="hidden items-center gap-8 text-[14px] text-ink-2 md:flex">
          <a href="#features">Features</a>
          <a href="#how">How it works</a>
          <a href="#collaborate">Collaborate</a>
          <a
            href="https://github.com/Nathandona/truecanvas"
            className="inline-flex items-center gap-1.5"
          >
            <BrandLogo name="github" size={16} mono />
            GitHub
          </a>
        </div>
        <a
          href="#start"
          className="press rounded-full bg-ink px-4 py-2 text-[14px] font-medium text-white"
        >
          Get started
        </a>
      </nav>
    </header>
  );
}
