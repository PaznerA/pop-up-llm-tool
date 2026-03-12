/**
 * Temporary HTTP server that opens a browser pop-up for tool approval.
 *
 * Used by both MCP server and Claude Code hooks.
 *
 * Flow:
 * 1. Start HTTP server on a random port
 * 2. Open browser to the approval page
 * 3. User reviews, edits, runs manually, approves/rejects
 * 4. Browser POSTs decision back
 * 5. Promise resolves with the decision
 * 6. Server shuts down
 */

import { createServer } from "http";
import { exec } from "child_process";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const APPROVAL_HTML = resolve(__dirname, "../public/approval.html");

/**
 * Request user approval for a tool call via browser pop-up.
 *
 * @param {object} opts
 * @param {string} opts.toolName   - Tool identifier
 * @param {object} opts.toolInput  - Tool parameters from the LLM
 * @param {object} opts.popup      - Pop-up display config { title, icon, description, fieldLabel }
 * @param {Function} [opts.execute] - Optional function to run manual execution
 * @returns {Promise<{ approved: boolean, modifiedInput?: object, manualResult?: any, reason?: string }>}
 */
export function requestApproval({ toolName, toolInput, popup, execute }) {
  return new Promise((resolveApproval) => {
    const requestId = crypto.randomUUID();

    const server = createServer(async (req, res) => {
      // CORS headers for the page
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = new URL(req.url, `http://localhost`);

      // Serve the approval page
      if (req.method === "GET" && url.pathname === "/") {
        const html = readFileSync(APPROVAL_HTML, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(html);
        return;
      }

      // Serve the initial data
      if (req.method === "GET" && url.pathname === "/data") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ requestId, toolName, toolInput, popup }));
        return;
      }

      // Manual execution
      if (req.method === "POST" && url.pathname === "/execute") {
        const body = await readBody(req);
        if (execute) {
          try {
            const result = await execute(body.input);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: err.message }));
          }
        } else {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: false, error: "Manual execution not available" }));
        }
        return;
      }

      // User decision
      if (req.method === "POST" && url.pathname === "/decide") {
        const body = await readBody(req);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));

        // Close server and resolve
        server.close();
        resolveApproval({
          approved: body.approved,
          modifiedInput: body.modifiedInput || null,
          manualResult: body.manualResult,
          reason: body.reason,
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    // Listen on random port
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const approvalUrl = `http://127.0.0.1:${port}/`;
      console.error(`[pop-up-llm-tool] Approval page: ${approvalUrl}`);
      openBrowser(approvalUrl);
    });

    // Timeout after 5 minutes
    const timeout = setTimeout(() => {
      server.close();
      resolveApproval({ approved: false, reason: "Approval timed out (5 min)" });
    }, 5 * 60 * 1000);

    server.on("close", () => clearTimeout(timeout));
  });
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data));
      } catch {
        resolve({});
      }
    });
  });
}

function openBrowser(url) {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? `open "${url}"`
      : platform === "win32"
        ? `start "${url}"`
        : `xdg-open "${url}" 2>/dev/null || sensible-browser "${url}" 2>/dev/null || echo "Open ${url} in your browser"`;

  exec(cmd, (err) => {
    if (err) {
      console.error(`[pop-up-llm-tool] Could not open browser. Open manually: ${url}`);
    }
  });
}
