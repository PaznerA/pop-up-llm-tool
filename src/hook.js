#!/usr/bin/env node

/**
 * Claude Code hook for pop-up tool approval.
 *
 * When configured as a PreToolUse hook, intercepts tool calls and opens
 * a browser pop-up for user review before Claude Code executes them.
 *
 * Hook behavior (exit codes):
 *   0          → approve (let Claude Code proceed)
 *   2          → block (reject, with reason on stdout)
 *   otherwise  → error
 *
 * Usage in .claude/settings.json or project settings:
 * {
 *   "hooks": {
 *     "PreToolUse": [
 *       {
 *         "matcher": "Bash|Read|Write|Edit",
 *         "command": "node /path/to/pop-up-llm-tool/src/hook.js"
 *       }
 *     ]
 *   }
 * }
 *
 * The hook receives tool info via CLAUDE_TOOL_USE_INPUT env var (JSON)
 * and the tool name via CLAUDE_TOOL_USE_NAME.
 */

import { requestApproval } from "./approval-server.js";

// Claude Code passes hook context via env vars
const toolName = process.env.CLAUDE_TOOL_USE_NAME || "unknown";
const toolInputRaw = process.env.CLAUDE_TOOL_USE_INPUT || "{}";

let toolInput;
try {
  toolInput = JSON.parse(toolInputRaw);
} catch {
  toolInput = { raw: toolInputRaw };
}

// Map Claude Code tool names to pop-up configs
const HOOK_CONFIGS = {
  Bash: {
    title: "Shell Command",
    icon: "terminal",
    description: "Claude wants to run a shell command",
    fieldLabel: "Command",
  },
  Read: {
    title: "Read File",
    icon: "code",
    description: "Claude wants to read a file",
    fieldLabel: "File Path",
  },
  Write: {
    title: "Write File",
    icon: "code",
    description: "Claude wants to write a file",
    fieldLabel: "Content",
  },
  Edit: {
    title: "Edit File",
    icon: "code",
    description: "Claude wants to edit a file",
    fieldLabel: "Changes",
  },
  // Add more as needed
};

const popup = HOOK_CONFIGS[toolName] || {
  title: toolName,
  icon: "code",
  description: `Claude wants to use: ${toolName}`,
  fieldLabel: "Input",
};

// Add source info so the approval page shows "HOOK" badge
const approvalUrl = "?source=hook";

async function main() {
  const decision = await requestApproval({
    toolName,
    toolInput,
    popup,
    // No execute function for hooks — Claude Code handles execution
    execute: null,
  });

  if (decision.approved) {
    // If user modified the input, output a message so Claude sees it
    if (decision.modifiedInput) {
      const orig = JSON.stringify(toolInput);
      const modified = JSON.stringify(decision.modifiedInput);
      if (orig !== modified) {
        // Print suggestion for Claude to use modified input
        console.log(
          `User approved but modified the input. Please use this instead:\n${JSON.stringify(decision.modifiedInput, null, 2)}`
        );
        // Exit 2 to block current call, so Claude retries with the modified input
        process.exit(2);
      }
    }
    // Approved without changes
    process.exit(0);
  } else {
    // Rejected
    const reason = decision.reason || "User rejected this action in the approval pop-up";
    console.log(reason);
    process.exit(2);
  }
}

main().catch((err) => {
  console.error(`[hook error] ${err.message}`);
  // Don't block on hook errors — let Claude proceed
  process.exit(0);
});
