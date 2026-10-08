import type { ReviewEnv } from "./env";
import { esc, icon, notFound, page, safeNext, sameOrigin } from "./http";
import { addMember, findInvite, isEmail, listInvites, listMembers, maySignIn, normalEmail, removeMember } from "./people";
import { createSignIn, nameFromEmail as defaultName, sendLinkEmail, signInOn, signOutHeaders, verifyUrl, viewerOf, type Viewer } from "./session";
import { getShare, listShares } from "./store";

/*
 * The signed-in side of the review site:
 *   /signin          ask for a sign-in link by email
 *   /continue        the email's link: a button that signs in (scanners don't click buttons)
 *   /signout         sign out
 *   /i/<token>       an invitation: a button that signs the invitee in and opens the link
 *   /members         the studio's members (owners add and remove them)
 *   /links           the studio's links, their access and invitees
 */
export async function signedIn(req: Request, env: ReviewEnv, parts: string[]): Promise<Response | null> {
  const [first, second] = parts;
  if (first === "i" && second && parts.length === 2) return invitation(req, env, second);
  if (parts.length !== 1) return null;
  switch (`${req.method} ${first}`) {
    case "GET signin":
      return signInPage(env, req, { next: new URL(req.url).searchParams.get("next"), error: new URL(req.url).searchParams.has("error") });
    case "POST signin":
      return requestSignIn(req, env);
    case "GET continue":
      return continuePage(req, env);
    case "POST signout": {
      if (!sameOrigin(req)) return notFound();
      const form = await req.formData().catch(() => null);
      const headers = await signOutHeaders(req, env);
      headers.set("location", new URL(safeNext(String(form?.get("next") ?? ""), "/signin"), req.url).href);
      return new Response(null, { status: 303, headers });
    }
    case "GET members":
    case "POST members":
      return members(req, env);
    case "GET links":
      return links(req, env);
  }
  return null;
}

// ---------- sign in ----------

export function signInPage(env: ReviewEnv, req: Request, opts: { next?: string | null; email?: string; error?: boolean; title?: string; intro?: string } = {}) {
  if (!signInOn(env)) return page(env, "Sign-in isn't set up", "Ask the studio for a link to the design.", 404);
  const next = safeNext(opts.next);
  return page(
    env,
    esc(opts.title ?? "Sign in"),
    `<form method="post" action="/signin">
      <label for="email">${esc(opts.intro ?? "Enter your email: we'll send you a link to sign in. No password needed.")}</label>
      <input id="email" name="email" type="email" placeholder="you@company.com" autocomplete="email" autofocus required value="${esc(opts.email ?? "")}" ${opts.error ? 'aria-invalid="true" aria-describedby="err"' : ""}>
      <input type="hidden" name="next" value="${esc(next)}">
      ${opts.error ? '<p id="err" class="err">That sign-in link has expired or was already used. Ask for a new one.</p>' : ""}
      <button type="submit">Email me a sign-in link</button>
    </form>`,
    opts.error ? 401 : 200,
  );
}

async function requestSignIn(req: Request, env: ReviewEnv): Promise<Response> {
  if (!signInOn(env) || !sameOrigin(req)) return notFound();
  const form = await req.formData().catch(() => null);
  const email = normalEmail(String(form?.get("email") ?? ""));
  const next = safeNext(String(form?.get("next") ?? ""));
  if (!isEmail(email)) return signInPage(env, req, { next, email });
  let devLink = "";
  // the same answer whether or not the email may sign in: nobody learns who the studio's clients are
  if (await maySignIn(env, email)) {
    const token = await createSignIn(req, env, email);
    if (token) {
      const link = continueUrl(req, token, next);
      const sent = await sendLinkEmail(env, email, "Your sign-in link", "Here's your link to sign in to the design review. It works once, for 15 minutes.", "Sign in", link);
      devLink = sent.link ?? "";
    }
  }
  return page(
    env,
    "Check your email",
    `<div class="stack"><p>If ${esc(email)} has access, a sign-in link is on its way. It works once, for 15 minutes.</p>${devLink ? `<p class="dev">Local development: <a id="dev-link" href="${esc(devLink)}">${esc(devLink)}</a></p>` : ""}</div>`,
  );
}

const continueUrl = (req: Request, token: string, next: string) => {
  const url = new URL("/continue", req.url);
  url.searchParams.set("token", token);
  url.searchParams.set("next", next);
  return url.href;
};

function continuePage(req: Request, env: ReviewEnv): Response {
  const q = new URL(req.url).searchParams;
  const token = q.get("token") ?? "";
  const next = safeNext(q.get("next"));
  if (!signInOn(env) || !/^[A-Za-z0-9_-]{8,200}$/.test(token)) return signInPage(env, req, { next, error: true });
  const go = verifyUrl(req, token, next, `/signin?error=1&next=${encodeURIComponent(next)}`);
  return page(env, "Sign in", `<div class="stack"><p>Continue to the design review.</p><a class="button" id="continue" href="${esc(go)}">Sign in</a></div>`);
}

// ---------- invitations ----------

async function invitation(req: Request, env: ReviewEnv, token: string): Promise<Response> {
  if (!signInOn(env)) return notFound();
  const invite = await findInvite(env, token);
  const share = invite ? await getShare(env, invite.slug) : null;
  if (!invite || !share || share.revoked) return page(env, "This invitation isn't valid anymore", "The studio may have removed it or sent you a newer one. Ask them for a new invitation.", 404);
  const viewer = await viewerOf(req, env);
  const linkPath = `/s/${share.slug}`;
  if (req.method === "GET") {
    if (viewer?.email === invite.email) return Response.redirect(new URL(linkPath, req.url).href, 303);
    return page(
      env,
      esc(share.title),
      `<form method="post" action="/i/${esc(token)}">
        <label>You're invited to review this design as <b>${esc(invite.email)}</b>.</label>
        <label for="name">Your name, shown on your comments</label>
        <input id="name" name="name" autocomplete="name" maxlength="60" placeholder="${esc(defaultName(invite.email))}">
        <button type="submit">Open the design</button>
      </form>`,
    );
  }
  if (req.method !== "POST" || !sameOrigin(req)) return notFound();
  const form = await req.formData().catch(() => null);
  const name = String(form?.get("name") ?? "").trim().slice(0, 60) || defaultName(invite.email);
  const signIn = await createSignIn(req, env, invite.email, name);
  if (!signIn) return page(env, "Something went wrong", "Try the invitation again in a moment.", 500);
  return Response.redirect(verifyUrl(req, signIn, linkPath, `/i/${token}`), 303);
}

/** Sends someone their invitation to a link. */
export async function sendInvitation(req: Request, env: ReviewEnv, email: string, token: string, title: string) {
  const link = new URL(`/i/${token}`, req.url).href;
  return sendLinkEmail(env, email, `You're invited to review ${title}`, `You're invited to review "${title}". Open it in your browser, pin comments on the design, and see it live.`, "Open the design", link);
}

// ---------- the studio: members and links ----------

/** A studio page: the members only, others sign in first. */
async function studioOnly(req: Request, env: ReviewEnv): Promise<Viewer | Response> {
  if (!signInOn(env)) return notFound();
  const viewer = await viewerOf(req, env);
  const path = new URL(req.url).pathname;
  if (!viewer) return signInPage(env, req, { next: path });
  if (!viewer.member) return page(env, "Studio members only", `<div class="stack"><p>You're signed in as ${esc(viewer.email)}, who isn't a member of the studio.</p>${signOutForm(path)}</div>`, 403);
  return viewer;
}

export const signOutForm = (next: string) => `<form method="post" action="/signout" class="alt"><input type="hidden" name="next" value="${esc(next)}"><button class="link-btn" type="submit">Sign out</button></form>`;

async function members(req: Request, env: ReviewEnv): Promise<Response> {
  const viewer = await studioOnly(req, env);
  if (viewer instanceof Response) return viewer;
  let error = "";
  if (req.method === "POST") {
    if (!sameOrigin(req) || !viewer.owner) return notFound();
    const form = await req.formData().catch(() => null);
    const email = normalEmail(String(form?.get("email") ?? ""));
    const action = String(form?.get("action") ?? "");
    if (!isEmail(email)) error = "That email doesn't look right.";
    else if (action === "add") await addMember(env, email, viewer.email);
    else if (action === "remove") await removeMember(env, email);
    if (!error) return Response.redirect(new URL("/members", req.url).href, 303);
  }
  const list = await listMembers(env);
  const rows = list
    .map(
      (m) =>
        `<li><span class="avatar" aria-hidden="true">${esc(m.email.slice(0, 1).toUpperCase())}</span><span class="grow"><span>${esc(m.email)}${m.email === viewer.email ? ' <span class="sub">(you)</span>' : ""}</span>${
          m.addedBy ? `<span class="sub">Added by ${esc(m.addedBy)}</span>` : '<span class="sub">From the site settings</span>'
        }</span>${
          m.owner
            ? '<span class="chip">Owner</span>'
            : viewer.owner
              ? `<form method="post" action="/members"><input type="hidden" name="email" value="${esc(m.email)}"><input type="hidden" name="action" value="remove"><button class="ghost" type="submit">Remove</button></form>`
              : '<span class="chip">Member</span>'
        }</li>`,
    )
    .join("");
  const add = viewer.owner
    ? `<div class="panel-add"><form method="post" action="/members" class="inline"><input name="email" type="email" required placeholder="name@your-studio.com" aria-label="Email to add"><input type="hidden" name="action" value="add"><button type="submit">Add member</button></form>${error ? `<p class="err" style="margin-top:8px">${esc(error)}</p>` : ""}</div>`
    : "";
  return page(
    env,
    "Members",
    `<div class="head"><div><h1>Members <span class="n">${list.length}</span></h1><p>Members see every link and sign in with their email. Owners are set in the site's settings${viewer.owner ? "" : " and add or remove members"}.</p></div></div>
<div class="panel" style="max-width:720px">${add}<ul class="rows">${rows}</ul></div>`,
    200,
    {},
    { app: { email: viewer.email, active: "members" } },
  );
}

const ACCESS = {
  invited: { label: "Invited people", icon: "users" },
  password: { label: "Password", icon: "lock" },
  public: { label: "Anyone with the link", icon: "globe" },
} as const;

/** "3 days ago", for the links page. */
function since(t: number) {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : d < 30 ? `${d} days ago` : new Date(t).toLocaleDateString("en", { day: "numeric", month: "short", year: "numeric" });
}

async function links(req: Request, env: ReviewEnv): Promise<Response> {
  const viewer = await studioOnly(req, env);
  if (viewer instanceof Response) return viewer;
  const shares = await listShares(env);
  // per link: open comments, and the latest version with its frames (for the preview)
  const [open, latest] = await Promise.all([
    env.DB.prepare("SELECT slug, COUNT(*) AS n FROM threads WHERE resolved = 0 GROUP BY slug").all<{ slug: string; n: number }>(),
    env.DB.prepare(
      "SELECT v.slug, v.id, v.frames, v.created_at AS at, m.n FROM versions v JOIN (SELECT slug, MAX(created_at) AS at, COUNT(*) AS n FROM versions GROUP BY slug) m ON m.slug = v.slug AND m.at = v.created_at",
    ).all<{ slug: string; id: string; frames: string; at: number; n: number }>(),
  ]);
  const openBy = new Map(open.results.map((r) => [r.slug, r.n]));
  const latestBy = new Map(latest.results.map((r) => [r.slug, r]));
  // the most recently updated first
  shares.sort((a, b) => (latestBy.get(b.slug)?.at ?? b.createdAt) - (latestBy.get(a.slug)?.at ?? a.createdAt));
  const cards = await Promise.all(
    shares.map(async (s) => {
      const invites = s.access === "invited" ? await listInvites(env, s.slug) : [];
      const v = latestBy.get(s.slug);
      let preview = "";
      try {
        const frames = v ? (JSON.parse(v.frames) as { name: string; image: string; route?: string }[]) : [];
        // a page frame if there is one: it's what the client opens
        const f = frames.find((x) => x.route) ?? frames[0];
        if (f && v) preview = `/s/${s.slug}/v/${v.id}/${f.image}`;
      } catch {
        /* no preview */
      }
      const access = ACCESS[s.access];
      const who =
        s.access === "invited"
          ? invites.length
            ? `<span class="chip" title="${esc(invites.map((i) => i.email).join(", "))}">${icon("users", 12)} ${invites.length === 1 ? esc(invites[0].email) : `${invites.length} people`}</span>`
            : `<span class="chip off">${icon("users", 12)} Nobody invited yet</span>`
          : `<span class="chip">${icon(access.icon, 12)} ${access.label}</span>`;
      const comments = openBy.get(s.slug) ?? 0;
      const url = new URL(`/s/${s.slug}`, req.url).href;
      const search = `${s.title} ${s.project} ${s.canvas} ${invites.map((i) => i.email).join(" ")}`.toLowerCase();
      return `<a class="card${s.revoked ? " revoked" : ""}" href="/s/${esc(s.slug)}" data-search="${esc(search)}">
  <div class="thumb">${preview ? `<img alt="" loading="lazy" decoding="async" src="${esc(preview)}" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'none',textContent:'No preview'}))">` : `<span class="none">No versions yet</span>`}
    <button class="copy" type="button" data-url="${esc(url)}" aria-label="Copy link" title="Copy link">${icon("copy")}</button></div>
  <div class="body"><span class="title">${esc(s.title)}</span><span class="sub">${esc(s.project)} / ${esc(s.canvas)}${v ? ` · ${v.n} version${v.n === 1 ? "" : "s"} · ${since(v.at)}` : ""}</span>
    <span class="chips">${comments ? `<span class="chip hot">${icon("message", 12)} ${comments} open comment${comments === 1 ? "" : "s"}</span>` : ""}${s.revoked ? '<span class="chip off">Revoked</span>' : who}</span></div>
</a>`;
    }),
  );
  const script = `<script>
document.addEventListener("click", (e) => {
  const b = e.target.closest(".copy");
  if (!b) return;
  e.preventDefault();
  navigator.clipboard.writeText(b.dataset.url).then(() => {
    const was = b.innerHTML;
    b.classList.add("done");
    b.innerHTML = ${JSON.stringify(icon("check"))};
    setTimeout(() => { b.classList.remove("done"); b.innerHTML = was; }, 1400);
  });
});
const q = document.getElementById("q");
if (q) q.addEventListener("input", () => {
  const t = q.value.trim().toLowerCase();
  let shown = 0;
  for (const c of document.querySelectorAll(".card")) { const hit = !t || c.dataset.search.includes(t); c.classList.toggle("hidden", !hit); shown += hit; }
  document.getElementById("none").classList.toggle("hidden", shown > 0);
});
</script>`;
  return page(
    env,
    "Links",
    `<div class="head"><div><h1>Links <span class="n">${shares.length}</span></h1><p>Every page shared from Truecanvas, the most recently updated first.</p></div>${
      shares.length ? `<label class="search">${icon("search")}<input id="q" type="search" placeholder="Search links or people" aria-label="Search links"></label>` : ""
    }</div>
${
  shares.length
    ? `<div class="grid">${cards.join("")}</div><p id="none" class="empty hidden">No link matches.</p>`
    : `<div class="empty"><b>No links yet</b><span>Share a page from Truecanvas (the Share button, or <code>npx truecanvas share home</code>): it shows up here.</span></div>`
}${script}`,
    200,
    {},
    { app: { email: viewer.email, active: "links" } },
  );
}
