import { Logo } from "@/components/logo";

export function SiteFooter() {
  return (
    <footer className="border-t border-line/70 px-6 pt-16 pb-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-14">
        <div className="grid gap-10 sm:grid-cols-2 md:grid-cols-[1.6fr_1fr_1fr_1fr]">
          <div className="flex flex-col gap-3">
            <Logo size={20} />
            <p className="max-w-xs text-[14px] leading-relaxed text-muted">
              Design with your real components. Open source and MIT licensed.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-[14px]">
            <span className="font-medium text-ink">Product</span>
            <a href="#features" className="text-muted hover:text-ink">
              Features
            </a>
            <a href="#how" className="text-muted hover:text-ink">
              How it works
            </a>
            <a href="#collaborate" className="text-muted hover:text-ink">
              Collaborate
            </a>
            <a href="#start" className="text-muted hover:text-ink">
              Get started
            </a>
          </div>
          <div className="flex flex-col gap-3 text-[14px]">
            <span className="font-medium text-ink">Resources</span>
            <a
              href="https://github.com/Nathandona/truecanvas#readme"
              className="text-muted hover:text-ink"
            >
              Docs
            </a>
            <a
              href="https://github.com/Nathandona/truecanvas#mcp-tools"
              className="text-muted hover:text-ink"
            >
              MCP tools
            </a>
            <a
              href="https://www.npmjs.com/package/truecanvas"
              className="text-muted hover:text-ink"
            >
              npm
            </a>
            <a
              href="https://github.com/Nathandona/truecanvas/releases"
              className="text-muted hover:text-ink"
            >
              Releases
            </a>
          </div>
          <div className="flex flex-col gap-3 text-[14px]">
            <span className="font-medium text-ink">Community</span>
            <a
              href="https://github.com/Nathandona/truecanvas"
              className="text-muted hover:text-ink"
            >
              GitHub
            </a>
            <a
              href="https://github.com/Nathandona/truecanvas/issues"
              className="text-muted hover:text-ink"
            >
              Issues
            </a>
            <a
              href="https://github.com/Nathandona/truecanvas/discussions"
              className="text-muted hover:text-ink"
            >
              Discussions
            </a>
          </div>
        </div>
        <div className="flex flex-col gap-4 border-t border-line/70 pt-6 text-[13px] text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>© 2026 Truecanvas · MIT License</span>
          <a
            href="https://altair-studio.com"
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-2 text-ink-2 hover:text-ink"
          >
            <svg width="18" height="18" viewBox="0 0 64 64" aria-hidden="true">
              <rect width="64" height="64" rx="15" fill="#161616" />
              <path d="M28.6 14h6.8L51 50h-7.4L32 22.4 20.4 50H13z" fill="#fff" />
            </svg>
            Made by Altair Studio
          </a>
        </div>
      </div>
    </footer>
  );
}
