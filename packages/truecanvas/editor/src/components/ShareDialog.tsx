import { useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Globe, LoaderCircle, Lock, Mail, MonitorPlay, Radio, Users } from "lucide-react";
import { api, type LinkInfo, type ShareAccess, type ShareResult } from "../lib/api";
import { useStore } from "../lib/store";
import { ago } from "../lib/time";
import { Select, Switch } from "./controls";
import { Dialog } from "./Dialog";
import { startLiveSession } from "./LiveSession";

/*
 * Share: the canvas's frames rendered by the app and published to the
 * studio's review site as the next version of this canvas's link, with the
 * real site (the app built as static pages) so clients scroll and click the
 * actual pages. Clients open it in a browser, nothing to install.
 * On review sites with sign-in, the link is for invited people: each gets an
 * email that signs them in.
 */

const ACCESS_OPTIONS = [
  { value: "invited", label: "Invited people" },
  { value: "password", label: "Anyone with the password" },
  { value: "public", label: "Anyone with the link" },
];

const ACCESS_NOTE: Record<ShareAccess, string> = {
  invited: "Invited people and your studio",
  password: "Anyone with the password",
  public: "Anyone with the link",
};

const ACCESS_ICON: Record<ShareAccess, typeof Users> = { invited: Users, password: Lock, public: Globe };

const REAL_SITE_KEY = "truecanvas.share.realSite";

export function openShare() {
  useStore.setState({ shareDialog: true });
}

export function ShareDialog() {
  const open = useStore((s) => s.shareDialog);
  const canvas = useStore((s) => s.canvas);
  if (!open || !canvas) return null;
  return <Share canvas={canvas} />;
}

function readRealSite() {
  try {
    return localStorage.getItem(REAL_SITE_KEY) !== "0";
  } catch {
    return true;
  }
}

function Share({ canvas }: { canvas: string }) {
  const [site, setSite] = useState<string | null | undefined>(undefined);
  // the review site has sign-in: invitations and access modes
  const [signIn, setSignIn] = useState(false);
  // this project can be built as static pages and the site hosts them
  const [canRealSite, setCanRealSite] = useState(false);
  const [realSite, setRealSite] = useState(readRealSite);
  // the canvas's link before this share (null: none yet)
  const [link, setLink] = useState<LinkInfo | null | undefined>(undefined);
  const [title, setTitle] = useState("");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  // null: the link keeps its access
  const [access, setAccess] = useState<ShareAccess | null>(null);
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<string | null>(null);
  const [result, setResult] = useState<ShareResult | null>(null);
  const close = () => useStore.setState({ shareDialog: false });

  useEffect(() => {
    api
      .shareStatus()
      .then((s) => {
        setSite(s.site);
        setSignIn(s.features?.includes("invites") ?? false);
        setCanRealSite(!!s.realSite);
        if (!s.site) setLink(null);
        else
          api
            .shareLink(canvas)
            .then((r) => setLink(r.link))
            .catch(() => setLink(null));
      })
      .catch(() => setSite(null));
  }, [canvas]);

  // what Share is doing, while it works
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      api
        .shareProgress()
        .then((p) => p.step && setStep(p.step))
        .catch(() => {});
    }, 600);
    return () => clearInterval(t);
  }, [busy]);

  const current: ShareAccess = link?.access ?? (link?.password ? "password" : link ? "public" : "invited");
  const chosen = access ?? current;
  const needsPassword = signIn ? chosen === "password" && !(link?.password && current === "password") : protect;
  const emails = invite
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  const share = async (local = false) => {
    setBusy(true);
    setStep(null);
    try {
      const done = await api.share({
        canvas,
        local,
        realSite: canRealSite && realSite,
        ...(title.trim() ? { title: title.trim() } : {}),
        ...(password && (needsPassword || chosen === "password") ? { password } : {}),
        ...(!local && signIn && access && access !== current ? { access } : {}),
        ...(!local && signIn && emails.length ? { invite: emails } : {}),
      });
      setResult(done);
      // the link is what people want next: it's already on the clipboard
      const url = done.published?.url;
      if (url) void navigator.clipboard?.writeText(url).catch(() => {});
    } catch (err) {
      useStore.getState().toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggleRealSite = (on: boolean) => {
    setRealSite(on);
    try {
      localStorage.setItem(REAL_SITE_KEY, on ? "1" : "0");
    } catch {}
  };

  if (busy) {
    return (
      <Dialog title={`Sharing ${canvas}`} busy onClose={close}>
        <Progress step={step} realSite={canRealSite && realSite} />
      </Dialog>
    );
  }

  if (result) {
    const m = result.manifest;
    const p = result.published;
    const url = p?.url ?? result.preview;
    return (
      <Dialog title={p ? `Version ${p.versions} is live` : "Preview ready"} width={460} onClose={close}>
        <p className="muted">
          {p
            ? `${m.frames.length} frame${m.frames.length === 1 ? "" : "s"}${p.live ? ", with the real site" : ""}. The link is copied: send it to your client.`
            : "A local preview of what clients would see. Connect a review site to send links."}
        </p>
        <LinkRow url={url} copiedAtFirst={!!p} />
        {p?.access && (
          <p className="faint share-note">
            <AccessIcon access={p.access} /> Who can open it: {ACCESS_NOTE[p.access].toLowerCase()}
          </p>
        )}
        {p?.invited.map((i) =>
          i.error ? (
            <p key={i.email} className="share-warn">
              Couldn't email {i.email}: {i.error}
            </p>
          ) : (
            <p key={i.email} className="faint share-note">
              <Mail size={11} /> Invited {i.email}: they got an email to open it
            </p>
          ),
        )}
        {result.realSiteError && (
          <details className="share-warn-box">
            <summary>The real site couldn't be built, so this version has frozen frames only.</summary>
            <pre className="mono">{result.realSiteError}</pre>
          </details>
        )}
        {m.external.length > 0 && <p className="share-warn">While rendering, the app called {m.external.join(", ")}. Whatever it showed is in the snapshot: use sample data for clients.</p>}
        {m.missing.length > 0 && <p className="share-warn">{m.missing.length} image or font file{m.missing.length === 1 ? "" : "s"} couldn't be fetched.</p>}
        {(p?.skipped.length ?? 0) > 0 && <p className="share-warn">Left out, over the 4.4 MB upload limit: {p!.skipped.join(", ")}</p>}
        <div className="modal-actions">
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  if (site === undefined || (site && link === undefined)) {
    return (
      <Dialog title={`Share ${canvas}`} width={460} onClose={close}>
        <div className="share-busy">
          <LoaderCircle size={16} className="spin-working" />
        </div>
      </Dialog>
    );
  }

  if (site === null) {
    return (
      <Dialog title={`Share ${canvas}`} width={460} onClose={close}>
        <p className="muted">
          Client links live on your own review site. Deploy it once (<span className="mono">packages/review-worker</span>, free on Cloudflare), then connect it:
        </p>
        <div className="share-cmd mono">npx truecanvas share setup</div>
        <div className="modal-actions">
          <button className="btn outline" onClick={close}>
            Close
          </button>
          <button className="btn primary" onClick={() => void share(true)}>
            Preview locally
          </button>
        </div>
      </Dialog>
    );
  }

  const host = site.replace(/^https?:\/\//, "");
  return (
    <Dialog title={`Share ${canvas}`} width={460} onClose={close}>
      {link ? (
        <div className="share-current">
          <LinkRow url={link.url} />
          <p className="faint share-note">
            <AccessIcon access={current} /> {ACCESS_NOTE[current]} · {link.versions} version{link.versions === 1 ? "" : "s"}
            {link.updatedAt ? `, latest ${ago(link.updatedAt, "long")}` : ""}
          </p>
        </div>
      ) : (
        <p className="muted">
          This page has no link yet. Publishing creates one on <span className="nowrap">{host}</span>.
        </p>
      )}

      {canRealSite && (
        <label className="share-option">
          <MonitorPlay size={15} className="share-option-icon" />
          <span>
            <b>Real site</b>
            <span className="faint">Clients scroll and click your actual pages, animations included. Builds your app first (a few seconds to a minute).</span>
          </span>
          <Switch on={realSite} onChange={toggleRealSite} ariaLabel="Include the real site" />
        </label>
      )}

      <div className="share-fields">
        {signIn ? (
          <>
            <div>
              <label className="share-label" htmlFor="share-invite">
                Invite by email <span className="faint">(optional)</span>
              </label>
              <div className="field">
                <input id="share-invite" autoFocus value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="client@company.com, another@company.com" autoComplete="off" />
              </div>
            </div>
            <div>
              <span className="share-label">Who can open it</span>
              <Select value={chosen} options={ACCESS_OPTIONS} onChange={(v) => setAccess(v as ShareAccess)} ariaLabel="Who can open it" />
            </div>
          </>
        ) : (
          <label className="share-check">
            <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Require a password
          </label>
        )}
        {(needsPassword || (signIn && chosen === "password")) && (
          <div className="field">
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={needsPassword ? "Password to give your client" : "New password (optional: keeps the current one)"}
              aria-label="Password"
              autoComplete="off"
            />
          </div>
        )}
        <div>
          <label className="share-label" htmlFor="share-title">
            Title clients see <span className="faint">(optional)</span>
          </label>
          <div className="field">
            <input id="share-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={link?.title ?? canvas} />
          </div>
        </div>
      </div>

      <div className="modal-actions share-actions">
        <button className="btn" onClick={() => void share(true)}>
          Preview locally
        </button>
        <button className="btn primary" disabled={needsPassword && !password} onClick={() => void share()}>
          {link ? `Publish version ${link.versions + 1}` : "Create link"}
        </button>
      </div>
      <LiveSection canvas={canvas} onStarted={close} />
    </Dialog>
  );
}

/** Working together in real time: the link shows the canvas live from the app while you edit. */
function LiveSection({ canvas, onStarted }: { canvas: string; onStarted: () => void }) {
  const session = useStore((s) => s.sessions[canvas]);
  const on = !!session && session.status !== "stopped";
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    try {
      await fn();
      after?.();
    } catch (err) {
      useStore.getState().toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="share-live">
      <Radio size={15} className="share-option-icon" />
      <span>
        <b>{on ? "Live session running" : "Live session"}</b>
        <span className="faint">
          {on
            ? "People with access to the link see your edits as you make them. End it when you're done."
            : "On a call with your client? They see your edits as you make them, with everyone's cursors, on the same link. It runs until you end it."}
        </span>
      </span>
      {on ? (
        <button className="btn danger" disabled={busy} onClick={() => void run(() => api.stopSession(canvas))}>
          End
        </button>
      ) : (
        <button className="btn outline" disabled={busy} onClick={() => void run(() => startLiveSession(canvas), onStarted)}>
          {busy && <LoaderCircle size={13} className="spin-working" />} Start
        </button>
      )}
    </div>
  );
}

function AccessIcon({ access }: { access: ShareAccess }) {
  const Icon = ACCESS_ICON[access];
  return <Icon size={11} />;
}

function LinkRow({ url, copiedAtFirst = false }: { url: string; copiedAtFirst?: boolean }) {
  const [copied, setCopied] = useState(copiedAtFirst);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    if (copiedAtFirst) timer.current = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer.current);
  }, [copiedAtFirst]);
  const copy = () => {
    void navigator.clipboard.writeText(url);
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  };
  return (
    <div className="share-link">
      <div className="field">
        <input readOnly value={url} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
      </div>
      <button className="btn outline" onClick={copy} aria-label="Copy link">
        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
      </button>
      <a className="btn outline" href={url} target="_blank" rel="noreferrer" aria-label="Open link" title="Open link">
        <ExternalLink size={13} />
      </a>
    </div>
  );
}

const STEPS = ["Rendering every frame through your app", "Building the real site", "Uploading"];

/** The share's steps, ticked as they finish. */
function Progress({ step, realSite }: { step: string | null; realSite: boolean }) {
  const steps = realSite ? STEPS : STEPS.filter((s) => s !== "Building the real site");
  const at = step ? steps.findIndex((s) => step.startsWith(s)) : 0;
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [at]);
  return (
    <div className="share-steps" role="status" aria-live="polite">
      {steps.map((s, i) => (
        <div key={s} className={`share-step${i < at ? " done" : i === at ? " now" : ""}`}>
          {i < at ? <Check size={13} /> : i === at ? <LoaderCircle size={13} className="spin-working" /> : <span className="share-step-dot" />}
          <span>{i === at && step ? step : s}</span>
          {i === at && seconds > 2 && <span className="faint share-step-time">{seconds}s</span>}
        </div>
      ))}
    </div>
  );
}
