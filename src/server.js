/**
 * Express + WebSocket server.
 *
 * - Serves the static frontend from /public
 * - Accepts WebSocket connections for the chat + tool-approval flow
 */

import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "url";
import { dirname, resolve, join } from "path";
import { mkdirSync } from "fs";
import { runAgentTurn } from "./agent.js";
import { TOOLS, seedDemoDb } from "./tools.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = resolve(__dirname, "..");

// Ensure data directory exists for SQLite
mkdirSync(join(ROOT, "data"), { recursive: true });
seedDemoDb();

const app = express();
const server = createServer(app);

// Serve static frontend
app.use(express.static(join(ROOT, "public")));

// WebSocket server
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log("Client connected");

  /** Conversation history for this session */
  const messages = [];

  /** Pending tool-approval callbacks: toolCallId -> { resolve } */
  const pendingApprovals = new Map();

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // --- User sends a chat message ---
    if (msg.type === "chat") {
      messages.push({ role: "user", content: msg.text });

      try {
        await runAgentTurn(messages, {
          onText(text) {
            ws.send(JSON.stringify({ type: "assistant_text", text }));
          },

          onToolRequest(toolName, toolInput, popupConfig) {
            return new Promise((resolveApproval) => {
              const requestId = crypto.randomUUID();

              pendingApprovals.set(requestId, { resolve: resolveApproval });

              // Tell the client to open a pop-up
              ws.send(
                JSON.stringify({
                  type: "tool_request",
                  requestId,
                  toolName,
                  toolInput,
                  popup: popupConfig,
                })
              );
            });
          },
        });

        ws.send(JSON.stringify({ type: "turn_complete" }));
      } catch (err) {
        console.error("Agent error:", err);
        ws.send(
          JSON.stringify({
            type: "error",
            message: err.message || "Agent error",
          })
        );
      }
    }

    // --- User responds to a tool-approval pop-up ---
    if (msg.type === "tool_response") {
      const pending = pendingApprovals.get(msg.requestId);
      if (pending) {
        pendingApprovals.delete(msg.requestId);
        pending.resolve({
          approved: msg.approved,
          modifiedInput: msg.modifiedInput || null,
          manualResult: msg.manualResult,
          reason: msg.reason,
        });
      }
    }

    // --- User wants to manually execute a tool (from the pop-up) ---
    if (msg.type === "manual_execute") {
      const tool = TOOLS[msg.toolName];
      if (!tool) {
        ws.send(
          JSON.stringify({
            type: "manual_result",
            requestId: msg.requestId,
            result: { error: "Unknown tool" },
          })
        );
        return;
      }

      try {
        const result = await tool.execute(msg.input);
        ws.send(
          JSON.stringify({
            type: "manual_result",
            requestId: msg.requestId,
            result,
          })
        );
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "manual_result",
            requestId: msg.requestId,
            result: { error: err.message },
          })
        );
      }
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    // Reject any pending approvals
    for (const [, pending] of pendingApprovals) {
      pending.resolve({ approved: false, reason: "Client disconnected" });
    }
    pendingApprovals.clear();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Pop-up LLM Tool running at http://localhost:${PORT}`);
});
