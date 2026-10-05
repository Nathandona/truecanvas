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
  let ready!: (c: Client) => void;
  let failed!: (e: unknown) => void;
  const upstream = new Promise<Client>((res, rej) => {
    ready = res;
    failed = rej;
  });

  const server = new Server({ name: "truecanvas", version: "0.1.0" }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS });
  server.oninitialized = async () => {
    try {
      const info = server.getClientVersion();
      const client = new Client({ name: info?.name ?? "stdio-agent", version: info?.version ?? "0.0.0" });
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
      ready(client);
    } catch (err) {
      failed(err);
    }
  };
  server.setRequestHandler(ListToolsRequestSchema, async () => (await upstream).listTools());
  server.setRequestHandler(CallToolRequestSchema, async (req) => (await upstream).callTool(req.params) as never);
  await server.connect(new StdioServerTransport());
}
