/* The Agent tab: connecting an agent, prompts to try, and the activity feed. */
import { ago, useClock } from "../lib/time";
import { useState } from "react";
import { Bot, Code2, Redo2, Sparkles, Undo2 } from "lucide-react";
import { useStore, layerName, agentLabel } from "../lib/store";
import { type CanvasNode, type FeedEntry } from "../lib/api";
import { revealOnCanvas } from "../lib/actions";

import { CopyButton, Section, Segmented, Tip } from "./controls";

const PROMPTS = [
  "Look at my selection in Truecanvas and make it denser.",
  "Create a dark-theme copy of the Chat frame and check it with a screenshot.",
  "Show every status of SessionRow in a new variants frame.",
  "Build an empty state for the sessions sidebar using our components.",
  "Add a soft mesh gradient shader behind the Settings frame.",
  "Make an iPhone 16 version of the Chat screen.",
];

export function AgentTab() {
  const agents = useStore((s) => s.agents);
  const mcpUrl = useStore((s) => s.mcpUrl);
  const feed = useStore((s) => s.feed);
  const history = useStore((s) => s.history);
  const selection = useStore((s) => s.selection);
  const index = useStore((s) => s.index);
  const [client, setClient] = useState<"claude" | "cursor" | "codex" | "url">("claude");
  const snippets = {
    claude: `claude mcp add --scope user --transport http truecanvas ${mcpUrl}`,
    cursor: JSON.stringify({ mcpServers: { truecanvas: { url: mcpUrl } } }, null, 2),
    codex: `[mcp_servers.truecanvas]\nurl = "${mcpUrl}"`,
    url: mcpUrl,
  };
  const hints = { claude: "Run once. Works in every project.", cursor: "Add to .cursor/mcp.json", codex: "Add to ~/.codex/config.toml", url: "Streamable HTTP endpoint" };
  const sel = selection.map((id) => index.get(id)?.node).filter(Boolean) as CanvasNode[];

  return (
    <>
      <Section title={agents.length ? "Connected" : "Connect an agent"}>
        {agents.length ? (
          <div>
            {agents.map((a) => (
              <div key={a.session} className="agent-row">
                <span className="live-dot" />
                <span style={{ fontWeight: 500 }}>{agentLabel(a.name)}</span>
                <span className="faint" style={{ marginLeft: "auto" }}>
                  active <Ago at={a.lastSeen} />
                </span>
              </div>
            ))}
            <p className="faint" style={{ margin: "8px 0 0" }}>Agents edit the canvas file over MCP. Every change lands below and can be undone.</p>
          </div>
        ) : (
          <>
            <p className="muted" style={{ margin: "-2px 0 10px", lineHeight: "17px" }}>
              Truecanvas has no built-in AI. Bring your own agent: it gets tools to read your components, edit frames and take screenshots.
            </p>
            <Segmented
              value={client}
              options={[
                { value: "claude", label: "Claude" },
                { value: "cursor", label: "Cursor" },
                { value: "codex", label: "Codex" },
                { value: "url", label: "URL" },
              ]}
              onChange={setClient}
            />
            <div className="code-block" style={{ marginTop: 8 }}>
              {snippets[client]}
              <CopyButton text={snippets[client]} />
            </div>
            <p className="faint" style={{ margin: "6px 0 0" }}>{hints[client]}</p>
          </>
        )}
      </Section>

      <Section title="Shared selection">
        {sel.length ? (
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {sel.map((n) => (
              <span key={n.id} className={`chip${n.kind === "component" ? " component" : ""}`}>
                {layerName(n)}
              </span>
            ))}
          </div>
        ) : (
          <p className="faint" style={{ margin: 0 }}>Select something and agents can read it with get_selection.</p>
        )}
        <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {PROMPTS.map((p) => (
            <PromptChip key={p} text={p} />
          ))}
        </div>
      </Section>

      <div className="section" style={{ padding: "12px 0 0" }}>
        <div className="section-title" style={{ padding: "0 12px" }}>
          <span>Activity</span>
          <span className="actions" style={{ marginRight: 6 }}>
            <Tip label="Undo" kbd="⌘Z">
              <button className="icon-btn sm" disabled={!history.undo} onClick={() => void useStore.getState().undo()} aria-label="Undo">
                <Undo2 size={13} />
              </button>
            </Tip>
            <Tip label="Redo" kbd="⇧⌘Z">
              <button className="icon-btn sm" disabled={!history.redo} onClick={() => void useStore.getState().redo()} aria-label="Redo">
                <Redo2 size={13} />
              </button>
            </Tip>
          </span>
        </div>
        <Feed entries={feed} />
      </div>
    </>
  );
}

function PromptChip({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="btn"
      style={{ justifyContent: "flex-start", height: "auto", padding: "6px 8px", whiteSpace: "normal", textAlign: "left", color: "var(--text-2)", lineHeight: "16px" }}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      }}
    >
      <Sparkles size={13} style={{ flex: "none", color: "var(--agent)" }} />
      <span>{copied ? "Copied. Paste it to your agent." : text}</span>
    </button>
  );
}

function Feed({ entries }: { entries: FeedEntry[] }) {
  const canvas = useStore((s) => s.canvas);
  const list = [...entries].reverse().slice(0, 60);
  if (!list.length) return <div className="empty">No changes yet. Edits from you, your agent and your code editor show up here.</div>;
  return (
    <div className="feed">
      {list.map((e, i) => {
        const show = (entry: typeof e) => (entry.ids.length ? revealOnCanvas(entry.canvas, entry.ids, { zoom: false }) : entry.canvas !== canvas && useStore.setState({ canvas: entry.canvas }));
        const who = e.actor.kind === "user" ? "You" : e.actor.kind === "agent" ? agentLabel(e.actor.name) : "Code editor";
        return (
          <div
            key={e.id}
            className={`feed-item${i === 0 && Date.now() - e.at < 2000 ? " new" : ""}`}
            role="button"
            tabIndex={0}
            onClick={() => show(e)}
            onKeyDown={(k) => {
              if (k.key !== "Enter" && k.key !== " ") return;
              k.preventDefault();
              show(e);
            }}
          >
            <span className={`avatar ${e.actor.kind}`}>{e.actor.kind === "agent" ? <Bot size={11} /> : e.actor.kind === "file" ? <Code2 size={11} /> : "Y"}</span>
            <div style={{ minWidth: 0 }}>
              <div>
                <span className="who">{who}</span> <span className="muted">{e.label.replace(/^./, (c) => c.toLowerCase())}</span>
              </div>
              <div className="when">
                <Ago at={e.at} />
                {e.canvas !== canvas && ` · ${e.canvas}`}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Ago({ at }: { at: number }) {
  useClock();
  return <>{ago(at, "long")}</>;
}
