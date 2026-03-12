/**
 * Claude agent loop.
 *
 * Runs a conversation with Claude, and whenever Claude calls a tool,
 * we pause execution and ask the user for approval via a pop-up window
 * (mediated through WebSocket).
 */

import Anthropic from "@anthropic-ai/sdk";
import { TOOLS, getClaudeTools } from "./tools.js";

const client = new Anthropic(); // uses ANTHROPIC_API_KEY env var

const SYSTEM_PROMPT = `You are a helpful assistant with access to tools.
When you need data or want to perform an action, use the appropriate tool.
Always explain what you plan to do before calling a tool.
After receiving tool results, analyze them and provide a clear summary to the user.`;

/**
 * Run one full agent turn.
 *
 * @param {Array} messages  - Conversation history (mutated in-place)
 * @param {Function} onText - Called with (text) for streaming assistant text
 * @param {Function} onToolRequest - Called with (toolName, toolInput, popupConfig)
 *   Must return { approved, modifiedInput, manualResult? }
 * @returns {string|null} Final assistant text of this turn, or null if still going
 */
export async function runAgentTurn(messages, { onText, onToolRequest }) {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: getClaudeTools(),
    messages,
  });

  // Collect text blocks and tool-use blocks
  const textParts = [];
  const toolCalls = [];

  for (const block of response.content) {
    if (block.type === "text") {
      textParts.push(block.text);
      onText(block.text);
    } else if (block.type === "tool_use") {
      toolCalls.push(block);
    }
  }

  // If no tool calls, conversation turn is done
  if (toolCalls.length === 0) {
    messages.push({ role: "assistant", content: response.content });
    return textParts.join("\n");
  }

  // Process each tool call — send pop-up, wait for approval, execute
  messages.push({ role: "assistant", content: response.content });

  const toolResults = [];

  for (const call of toolCalls) {
    const tool = TOOLS[call.name];
    if (!tool) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
      });
      continue;
    }

    // Ask user for approval via pop-up
    const decision = await onToolRequest(call.name, call.input, tool.popup);

    if (!decision.approved) {
      toolResults.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: JSON.stringify({
          error: "User rejected this tool call",
          reason: decision.reason || "No reason provided",
        }),
      });
      continue;
    }

    // Use modified input if user edited it, otherwise use original
    const finalInput = decision.modifiedInput || call.input;

    // If user manually ran it and provided a result, use that
    let result;
    if (decision.manualResult !== undefined) {
      result = decision.manualResult;
    } else {
      result = await tool.execute(finalInput);
    }

    toolResults.push({
      type: "tool_result",
      tool_use_id: call.id,
      content: JSON.stringify(result),
    });
  }

  messages.push({ role: "user", content: toolResults });

  // Continue the agent loop — Claude may want to call more tools or respond
  return runAgentTurn(messages, { onText, onToolRequest });
}
