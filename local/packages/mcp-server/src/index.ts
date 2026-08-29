import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ToderoApiClient } from "./client.js";
import { readConfigFromEnv, type ToderoMcpConfig } from "./config.js";
import { createToolDefinitions } from "./tools.js";

export function createToderoMcpServer(config: ToderoMcpConfig = readConfigFromEnv()) {
  const server = new McpServer({
    name: "todero",
    version: "0.1.0",
  });

  const client = new ToderoApiClient(config);
  const tools = createToolDefinitions(client);
  for (const tool of tools) {
    server.tool(tool.name, tool.description, tool.schema.shape, tool.execute);
  }

  return {
    server,
    tools,
    client,
  };
}

export async function runServer(config: ToderoMcpConfig = readConfigFromEnv()) {
  const { server } = createToderoMcpServer(config);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
