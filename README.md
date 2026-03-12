# Pop-up LLM Tool

An agentic LLM system where **tool calls pop out in browser windows** for human-in-the-loop approval.

Instead of executing tools silently, every action the AI wants to take (SQL query, shell command, HTTP request) opens a dedicated pop-up window where you can:

1. **Review** what the AI wants to do and why
2. **Edit** the input (e.g., modify a SQL query)
3. **Run manually** to preview the result before approving
4. **Approve or reject** — only approved results are sent back to the AI

## Architecture

```
┌─────────────┐       WebSocket       ┌─────────────────┐
│  Browser     │ ◄──────────────────► │  Node.js Server  │
│  (Chat UI)   │                      │                  │
│              │   tool_request ──►   │   Claude API     │
│  opens ──►   │                      │   Agent Loop     │
│  Pop-up      │   ◄── tool_response  │                  │
│  Window      │                      │   Tool Registry  │
└─────────────┘                       └─────────────────┘
```

**Flow:**
1. User chats with the AI in the main window
2. AI decides to call a tool (e.g., `run_sql_query`)
3. Server sends a `tool_request` over WebSocket
4. Main window opens a **pop-up window** with the tool details
5. User reviews, optionally edits, optionally runs manually
6. User clicks **Approve** or **Reject**
7. Pop-up sends decision back to main window → WebSocket → server
8. Server executes (if approved) and sends result to Claude
9. Claude processes the result and responds

## Getting Started

### Prerequisites
- Node.js 20+
- An [Anthropic API key](https://console.anthropic.com/)

### Install & Run

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Try It

- **"Show me all users in the database"** → opens SQL query pop-up
- **"How many pending orders are there?"** → SQL pop-up with COUNT query
- **"List files in the current directory"** → shell command pop-up

## Built-in Tools

| Tool | Description | Pop-up lets you... |
|------|-------------|-------------------|
| `run_sql_query` | Query a SQLite database | Edit SQL, run it, see results |
| `run_shell_command` | Execute shell commands | Edit command, preview output |
| `fetch_url` | Make HTTP requests | Edit URL, preview response |

### Adding Custom Tools

Add a new entry to the `TOOLS` object in `src/tools.js`:

```js
export const TOOLS = {
  my_tool: {
    claude_tool: {
      name: "my_tool",
      description: "What this tool does",
      input_schema: { /* JSON Schema */ },
    },
    popup: {
      title: "My Tool",
      icon: "terminal",        // database | terminal | globe
      description: "The AI wants to use my tool",
      fieldLabel: "Input",
      language: "text",
    },
    execute(params) {
      // Run the tool and return a result object
      return { success: true, data: "..." };
    },
  },
};
```

## Integration: Use in Other Projects

There are **three ways** to use the pop-up approval flow. All share the same browser pop-up UI.

### Option A: Standalone (own chat UI)

Run as a self-contained app with its own chat interface and Claude API calls:

```bash
npm install && ANTHROPIC_API_KEY=sk-ant-... npm start
```

### Option B: MCP Server (for Claude Code / any MCP client)

Add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "pop-up-tools": {
      "command": "node",
      "args": ["/absolute/path/to/pop-up-llm-tool/src/mcp-server.js"]
    }
  }
}
```

When Claude Code calls any registered tool, a browser window opens for approval. The MCP server handles tool execution after approval.

### Option C: Claude Code Hooks (intercept any tool call)

Add to `.claude/settings.json` in your project:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash|Write|Edit",
        "command": "node /absolute/path/to/pop-up-llm-tool/src/hook.js"
      }
    ]
  }
}
```

This intercepts Claude Code's *own* tools (Bash, Write, Edit, etc.) — every matched action opens a pop-up before Claude Code executes it. Unlike MCP, the hook doesn't execute the tool itself; it only gates whether Claude Code proceeds.

**Key difference:**
- **MCP** = adds new tools that Claude can call, with pop-up approval + execution
- **Hooks** = intercepts Claude Code's built-in tools before they run

You can use both together.

## Project Structure

```
src/
  server.js          Standalone Express + WebSocket server
  agent.js           Claude agent loop with tool-call interception
  tools.js           Tool definitions + execution logic
  mcp-server.js      MCP server (stdio transport)
  hook.js            Claude Code PreToolUse hook
  approval-server.js Shared: temp HTTP server that opens browser pop-up
public/
  index.html         Main chat UI (standalone mode)
  popup.html         Pop-up window (standalone WebSocket mode)
  approval.html      Pop-up window (MCP / hooks mode, uses HTTP)
data/
  demo.db            Auto-created SQLite demo database
```

## Key Design Decisions

- **Pop-up windows** (not modals) so the user can compare the tool action with the chat context side-by-side
- **Manual execution** before approval lets users verify results without committing
- **Editable inputs** so users can fix AI mistakes before execution
- **Three integration modes** — standalone, MCP, and hooks — sharing the same approval UX
- **Extensible tool registry** — add new tools with just a config object

## License

MIT
