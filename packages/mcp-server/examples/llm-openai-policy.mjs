#!/usr/bin/env node
/**
 * OPTIONAL, documentation-only example: drives one NullCity run through
 * the MCP tool surface using an OpenAI model as the decision-maker,
 * instead of a deterministic policy. This file is intentionally **not**
 * part of `pnpm verify`, `pnpm test`, or any CI gate (see root
 * `package.json` / `docs/decisions/2026-08-07-m5-sdk-benchmark-mcp.md`)
 * — provider/LLM logic never belongs in the deterministic core, and a
 * benchmark suite that requires a paid API key by default is not
 * reproducible.
 *
 * Requires `OPENAI_API_KEY` in the environment and the `openai` package
 * (not a workspace dependency — install it yourself if you want to run
 * this: `npm install openai`). Without a key, this fails immediately
 * with a clear, actionable error rather than hanging or silently no-op'ing.
 *
 * Run:
 *   OPENAI_API_KEY=sk-... node packages/mcp-server/examples/llm-openai-policy.mjs
 */
import { createServer } from "@null-city/server";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createNullCityMcpServer } from "../dist/server.js";

const MAX_TURNS = 60;

async function main() {
  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set. This example demonstrates an LLM-driven policy over the MCP " +
        "tool surface and requires a real OpenAI API key — it is intentionally excluded from " +
        "`pnpm verify`/CI for exactly this reason. Set OPENAI_API_KEY and rerun.",
    );
  }

  let OpenAI;
  try {
    ({ default: OpenAI } = await import("openai"));
  } catch {
    throw new Error(
      "The optional `openai` package is not installed. Run `npm install openai` in " +
        "packages/mcp-server before using this example. It is intentionally not a workspace " +
        "dependency so the deterministic core/CI never pulls in a provider SDK.",
    );
  }

  const openai = new OpenAI({ apiKey });

  const app = createServer();
  const port = await app.listen(0, "127.0.0.1");
  const instance = await createNullCityMcpServer({
    baseUrl: `http://127.0.0.1:${port}`,
    scenarioId: "black-river",
    seed: 49314,
    sessionId: "mcp-llm-example",
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "llm-example-client", version: "0.0.0" });
  await Promise.all([client.connect(clientTransport), instance.server.server.connect(serverTransport)]);

  const { tools } = await client.listTools();
  const openaiTools = tools.map((tool) => ({
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.inputSchema },
  }));

  const messages = [
    {
      role: "system",
      content:
        "You are an emergency-management operator playing NullCity. You can only observe and act " +
        "through the provided tools — you never see ground truth, only what these tools report. " +
        "Use advance_time to move the run forward; call get_completed_summary to check for the end.",
    },
    { role: "user", content: "Play the black-river scenario to completion, minimizing risk and score loss." },
  ];

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools: openaiTools,
      tool_choice: "auto",
    });
    const choice = completion.choices[0];
    messages.push(choice.message);

    const calls = choice.message.tool_calls ?? [];
    if (calls.length === 0) {
      break;
    }

    for (const call of calls) {
      const args = JSON.parse(call.function.arguments || "{}");
      const result = await client.callTool({ name: call.function.name, arguments: args });
      const text = result.content?.[0]?.text ?? "";
      messages.push({ role: "tool", tool_call_id: call.id, content: text });

      if (call.function.name === "get_completed_summary") {
        try {
          if (JSON.parse(text).completed) {
            console.log("=== MCP + LLM example ===");
            console.log(text);
            await client.close();
            await instance.close();
            await app.close();
            return;
          }
        } catch {
          // ignore parse errors, keep going
        }
      }
    }
  }

  console.warn(`Stopped after ${MAX_TURNS} turns without a completed run.`);
  await client.close();
  await instance.close();
  await app.close();
}

main().catch((error) => {
  console.error(`llm-openai-policy example failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
