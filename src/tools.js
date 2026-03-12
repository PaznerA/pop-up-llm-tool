/**
 * Tool definitions for the LLM agent.
 *
 * Each tool has:
 * - claude_tool: The tool schema sent to Claude API
 * - popup: Configuration for the pop-up approval window
 * - execute(params): Runs the tool server-side after user approval
 */

import Database from "better-sqlite3";
import { resolve } from "path";

// Shared SQLite database for the SQL tool demo
const DB_PATH = resolve("data/demo.db");

function getDb() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  return db;
}

/** Seed a small demo database if it doesn't exist */
export function seedDemoDb() {
  const db = getDb();
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES users(id),
      product TEXT NOT NULL,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'pending',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  const count = db.prepare("SELECT COUNT(*) as c FROM users").get();
  if (count.c === 0) {
    const insertUser = db.prepare(
      "INSERT INTO users (name, email, role) VALUES (?, ?, ?)"
    );
    const insertOrder = db.prepare(
      "INSERT INTO orders (user_id, product, amount, status) VALUES (?, ?, ?, ?)"
    );

    insertUser.run("Alice Johnson", "alice@example.com", "admin");
    insertUser.run("Bob Smith", "bob@example.com", "user");
    insertUser.run("Carol White", "carol@example.com", "user");
    insertUser.run("Dave Brown", "dave@example.com", "manager");

    insertOrder.run(1, "Widget Pro", 49.99, "completed");
    insertOrder.run(2, "Gadget X", 29.99, "pending");
    insertOrder.run(1, "Widget Lite", 19.99, "completed");
    insertOrder.run(3, "Gadget X", 29.99, "shipped");
    insertOrder.run(4, "Widget Pro", 49.99, "pending");
    insertOrder.run(2, "Super Bundle", 99.99, "completed");
  }
  db.close();
}

// ---------------------------------------------------------------------------
// Tool registry
// ---------------------------------------------------------------------------

export const TOOLS = {
  run_sql_query: {
    claude_tool: {
      name: "run_sql_query",
      description:
        "Run a SQL query against the application database. Use SELECT for reads. The user will review and optionally modify the query before it runs.",
      input_schema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The SQL query to execute",
          },
          purpose: {
            type: "string",
            description:
              "Brief explanation of why this query is needed, shown to the user",
          },
        },
        required: ["query", "purpose"],
      },
    },
    popup: {
      title: "SQL Query",
      icon: "database",
      description: "The AI wants to run a SQL query",
      fieldLabel: "SQL Query",
      language: "sql",
    },
    execute(params) {
      const db = getDb();
      try {
        const sql = params.query.trim();
        if (/^\s*(SELECT|PRAGMA|EXPLAIN)/i.test(sql)) {
          const rows = db.prepare(sql).all();
          return { success: true, rows, rowCount: rows.length };
        }
        const info = db.prepare(sql).run();
        return { success: true, changes: info.changes };
      } catch (err) {
        return { success: false, error: err.message };
      } finally {
        db.close();
      }
    },
  },

  run_shell_command: {
    claude_tool: {
      name: "run_shell_command",
      description:
        "Run a shell command on the server. The user will review and can modify the command before execution.",
      input_schema: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute",
          },
          purpose: {
            type: "string",
            description: "Brief explanation of why this command is needed",
          },
        },
        required: ["command", "purpose"],
      },
    },
    popup: {
      title: "Shell Command",
      icon: "terminal",
      description: "The AI wants to run a shell command",
      fieldLabel: "Command",
      language: "bash",
    },
    async execute(params) {
      const { execSync } = await import("child_process");
      try {
        const output = execSync(params.command, {
          timeout: 30000,
          encoding: "utf-8",
          maxBuffer: 1024 * 1024,
        });
        return { success: true, output };
      } catch (err) {
        return {
          success: false,
          error: err.message,
          output: err.stdout || "",
        };
      }
    },
  },

  fetch_url: {
    claude_tool: {
      name: "fetch_url",
      description:
        "Fetch content from a URL. The user will review the URL before the request is made.",
      input_schema: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "The URL to fetch",
          },
          method: {
            type: "string",
            enum: ["GET", "POST"],
            description: "HTTP method (default GET)",
          },
          purpose: {
            type: "string",
            description: "Brief explanation of why this fetch is needed",
          },
        },
        required: ["url", "purpose"],
      },
    },
    popup: {
      title: "HTTP Request",
      icon: "globe",
      description: "The AI wants to fetch a URL",
      fieldLabel: "URL",
      language: "text",
    },
    async execute(params) {
      try {
        const resp = await fetch(params.url, {
          method: params.method || "GET",
          signal: AbortSignal.timeout(15000),
        });
        const text = await resp.text();
        return {
          success: resp.ok,
          status: resp.status,
          body: text.slice(0, 5000),
        };
      } catch (err) {
        return { success: false, error: err.message };
      }
    },
  },
};

/** Return array of Claude tool schemas for the API call */
export function getClaudeTools() {
  return Object.values(TOOLS).map((t) => t.claude_tool);
}
