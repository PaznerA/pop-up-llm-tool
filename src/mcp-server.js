#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) server for pop-up tool approval.
 *
 * Exposes tools that, when called by Claude Code, open a browser pop-up
 * for the user to review, edit, and approve before execution.
 *
 * Usage in .mcp.json:
 * {
 *   "mcpServers": {
 *     "pop-up-tools": {
 *       "command": "node",
 *       "args": ["/path/to/pop-up-llm-tool/src/mcp-server.js"]
 *     }
 *   }
 * }
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { requestApproval } from "./approval-server.js";
import { TOOLS } from "./tools.js";
import { mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Ensure data dir exists for SQLite
mkdirSync(resolve(__dirname, "../data"), { recursive: true });

// Optionally seed the demo DB
import { seedDemoDb } from "./tools.js";
try {
  seedDemoDb();
} catch {
  // DB might not be needed for all tools
}

const server = new Server(
  { name: "pop-up-llm-tool", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

// --- List tools ---
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: Object.values(TOOLS).map((t) => ({
      name: t.claude_tool.name,
      description: t.claude_tool.description,
      inputSchema: t.claude_tool.input_schema,
    })),
  };
});

// --- Call tool ---
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const tool = TOOLS[name];

  if (!tool) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: `Unknown tool: ${name}` }) }],
      isError: true,
    };
  }

  // Open browser pop-up and wait for user approval
  console.error(`[MCP] Tool "${name}" requested — opening approval pop-up...`);

  const decision = await requestApproval({
    toolName: name,
    toolInput: args,
    popup: tool.popup,
    execute: (input) => tool.execute(input),
  });

  if (!decision.approved) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            rejected: true,
            reason: decision.reason || "User rejected the tool call",
          }),
        },
      ],
      isError: false,
    };
  }

  // If user already ran it manually and we have a result, use that
  if (decision.manualResult !== undefined) {
    return {
      content: [{ type: "text", text: JSON.stringify(decision.manualResult) }],
    };
  }

  // Execute with (possibly modified) input
  const finalInput = decision.modifiedInput || args;
  try {
    const result = await tool.execute(finalInput);
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
      isError: !result.success,
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: JSON.stringify({ error: err.message }) }],
      isError: true,
    };
  }
});

// --- Start ---
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[MCP] Pop-up LLM Tool server running on stdio");
}

main().catch((err) => {
  console.error("MCP server failed:", err);
  process.exit(1);
});
