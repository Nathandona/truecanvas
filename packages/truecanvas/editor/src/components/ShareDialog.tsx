import { useEffect, useState } from "react";
import { Check, Copy, ExternalLink, LoaderCircle, Lock, Mail, Users } from "lucide-react";
import { api, type ShareAccess, type ShareResult } from "../lib/api";
import { useStore } from "../lib/store";
import { Select } from "./controls";
import { Dialog } from "./Dialog";

/*
 * Share: the canvas's frames rendered by the app, frozen (no scripts, no API
 * calls) and published to the studio's review site as the next version of
 * this canvas's link. Clients open it in a browser, nothing to install.
 * On review sites with sign-in, the link is for invited people: each gets an
 * email that signs them in.
 */

const ACCESS_OPTIONS = [
  { value: "", label: "Keep the link's access" },
  { value: "invited", label: "Invited people" },
  { value: "password", label: "Anyone with the password" },
  { value: "public", label: "Anyone with the link" },
];

const ACCESS_NOTE: Record<ShareAccess, string> = {
  invited: "Only invited people and your studio can open it.",
  password: "Password protected",
  public: "Anyone with the link can open it.",
};

export function openShare() {
  useStore.setState({ shareDialog: true });
}

export function ShareDialog() {
  const open = useStore((s) => s.shareDialog);
  const canvas = useStore((s) => s.canvas);
  if (!open || !canvas) return null;
  return <Share canvas={canvas} />;
}

function Share({ canvas }: { canvas: string }) {
  const [site, setSite] = useState<string | null | undefined>(undefined);
  // the review site has sign-in: invitations and access modes
  const [signIn, setSignIn] = useState(false);
  // empty: the link keeps its title (the page name for a new link)
  const [title, setTitle] = useState("");
  const [protect, setProtect] = useState(false);
  const [password, setPassword] = useState("");
  // empty: the link keeps its access (new links: invited people)
  const [access, setAccess] = useState<ShareAccess | "">("");
  const [invite, setInvite] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);
  const close = () => useStore.setState({ shareDialog: false });

  useEffect(() => {
    api
      .shareStatus()
      .then((s) => {
        setSite(s.site);
        setSignIn(s.features?.includes("invites") ?? false);
      })
      .catch(() => setSite(null));
  }, []);

  const needsPassword = signIn ? access === "password" : protect;
  const emails = invite
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  const share = async (local = false) => {
    setBusy(true);
    try {
      setResult(
        await api.share({
          canvas,
          local,
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(needsPassword && password ? { password } : {}),
          ...(!local && signIn && access ? { access } : {}),
          ...(!local && signIn && emails.length ? { invite: emails } : {}),
        }),
      );
    } catch (err) {
      useStore.getState().toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const link = result?.published?.url ?? result?.preview ?? "";
  const copy = () => {
    void navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (busy) {
    return (
      <Dialog title="Share" busy onClose={close}>
        <div className="share-busy" role="status">
          <LoaderCircle size={16} className="spin-working" />
          <span className="muted">Rendering every frame through your app, then freezing it…</span>
        </div>
      </Dialog>
    );
  }

  if (result) {
    const m = result.manifest;
    return (
      <Dialog title={result.published ? "Shared" : "Preview ready"} width={440} onClose={close}>
        <p className="muted">
          {result.published
            ? `Version ${result.published.versions} of this canvas's link: ${m.frames.length} frame${m.frames.length === 1 ? "" : "s"}, frozen. Clients see it in their browser and can't run anything.`
            : "A local preview of what clients would see. Connect a review site to send links."}
        </p>
        <div className="share-link">
          <div className="field">
            <input readOnly value={link} aria-label="Link" onFocus={(e) => e.currentTarget.select()} />
          </div>
          <button className="btn outline" onClick={copy} aria-label="Copy link">
            {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? "Copied" : "Copy"}
          </button>
          <a className="btn outline" href={link} target="_blank" rel="noreferrer" aria-label="Open link">
            <ExternalLink size={13} />
          </a>
        </div>
        {result.published?.access ? (
          <p className="faint share-note">
            {result.published.access === "invited" ? <Users size={11} /> : result.published.access === "password" ? <Lock size={11} /> : null} {ACCESS_NOTE[result.published.access]}
          </p>
        ) : (
          result.published?.password && (
            <p className="faint share-note">
              <Lock size={11} /> Password protected
            </p>
          )
        )}
        {result.published?.invited.map((i) =>
          i.error ? (
            <p key={i.email} className="share-warn">
              Couldn't email {i.email}: {i.error}
            </p>
          ) : (
            <p key={i.email} className="faint share-note">
              <Mail size={11} /> Invited {i.email}
            </p>
          ),
        )}
        {m.external.length > 0 && <p className="share-warn">While rendering, the app called {m.external.join(", ")}. Whatever it showed is in the snapshot: use sample data for clients.</p>}
        {m.missing.length > 0 && <p className="share-warn">{m.missing.length} image or font file{m.missing.length === 1 ? "" : "s"} couldn't be fetched.</p>}
        {(result.published?.skipped.length ?? 0) > 0 && <p className="share-warn">Left out, over the 4.4 MB upload limit: {result.published!.skipped.join(", ")}</p>}
        <div className="modal-actions">
          <button className="btn primary" onClick={close}>
            Done
          </button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Share" width={440} onClose={close}>
      {site === undefined ? (
        <div className="share-busy">
          <LoaderCircle size={16} className="spin-working" />
        </div>
      ) : site === null ? (
        <>
          <p className="muted">
            Client links live on your own review site. Deploy it once (the <span className="mono">packages/review</span> app), then connect it:
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
        </>
      ) : (
        <>
          <p className="muted">
            Every frame of this page, frozen as it renders now and published to <span className="mono">{site.replace(/^https?:\/\//, "")}</span>. Sharing again adds a version to the same link.
          </p>
          <label className="share-label" htmlFor="share-title">
            Title clients see <span className="faint">(optional)</span>
          </label>
          <div className="field">
            <input id="share-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={`Keep the link's title (new links: ${canvas})`} />
          </div>
          {signIn ? (
            <>
              <label className="share-label" htmlFor="share-invite">
                Invite by email <span className="faint">(optional)</span>
              </label>
              <div className="field">
                <input id="share-invite" value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="client@company.com, another@company.com" autoComplete="off" />
              </div>
              <span className="share-label">Who can open it</span>
              <Select value={access} options={ACCESS_OPTIONS} onChange={(v) => setAccess(v as ShareAccess | "")} ariaLabel="Who can open it" />
            </>
          ) : (
            <label className="share-check">
              <input type="checkbox" checked={protect} onChange={(e) => setProtect(e.target.checked)} /> Require a password
            </label>
          )}
          {needsPassword && (
            <div className="field">
              <input type="text" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password to give your client" aria-label="Password" autoComplete="off" />
            </div>
          )}
          <div className="modal-actions share-actions">
            <button className="btn" onClick={() => void share(true)}>
              Preview locally
            </button>
            <button className="btn primary" disabled={needsPassword && !password} onClick={() => void share()}>
              Share link
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
