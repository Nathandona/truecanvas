import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { INSTRUCTIONS } from "./mcp.js";

/**
 * stdio ↔ HTTP bridge for MCP clients that only speak stdio. The agent's own
 * client name is forwarded so the editor shows who is editing.
 */
export async function runStdioBridge(mcpUrl: string) {
  const server = new Server({ name: "truecanvas", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  let client: Promise<Client> | null = null;
  // connects on first use, and again after the editor restarts
  const connect = () => {
    if (!client) {
      const info = server.getClientVersion();
      const c = new Client({ name: info?.name ?? "stdio-agent", version: info?.version ?? "0.0.0" });
      const pending = c.connect(new StreamableHTTPClientTransport(new URL(mcpUrl))).then(() => c);
      pending.catch(() => client === pending && (client = null));
      client = pending;
    }
    return client;
  };
  const withUpstream = async <T,>(fn: (c: Client) => Promise<T>): Promise<T> => {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn(await connect());
      } catch (err) {
        client = null;
        // only a lost session is retried: a timeout may have applied an edit already
        const lost = /session|not connected|ECONNREFUSED|ECONNRESET|fetch failed|404/i.test((err as Error).message ?? "");
        if (attempt > 0 || !lost) throw err;
      }
    }
  };
  server.setRequestHandler(ListToolsRequestSchema, () => withUpstream((c) => c.listTools()));
  server.setRequestHandler(CallToolRequestSchema, (req) => withUpstream((c) => c.callTool(req.params, undefined, { timeout: 180_000 })) as never);
  await server.connect(new StdioServerTransport());
}
