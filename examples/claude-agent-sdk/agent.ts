// A Claude Agent SDK agent that has crosscheck review its draft before answering.
//
//   npm install
//   ANTHROPIC_API_KEY=... CROSSCHECK_WALLET_KEY=0x... npx tsx agent.ts
//
// Add CROSSCHECK_NETWORKS: "eip155:84532" to env to pay with free test USDC on Base Sepolia.
import { query } from "@anthropic-ai/claude-agent-sdk";

const INSTRUCTIONS = `You write emails for your human.
Before you give your human any draft that contains numbers, dates, money, or commitments,
or that will be sent to someone else, call crosscheck's order tool with the full draft
exactly as your human will see it. Fix every blocker and major issue it reports.
Say the draft was checked only if the verdict passed.`;

const key = process.env.CROSSCHECK_WALLET_KEY;
if (!key) throw new Error("Set CROSSCHECK_WALLET_KEY to the private key of a dedicated wallet");

for await (const message of query({
  prompt: "Email Sam: the venue is booked for Thursday the 12th, catering is $1,200 and AV is $450, so we are within the $2,000 budget.",
  options: {
    systemPrompt: INSTRUCTIONS,
    mcpServers: {
      crosscheck: { type: "stdio", command: "npx", args: ["-y", "crosscheckapi"], env: { CROSSCHECK_WALLET_KEY: key } },
    },
    // quote and result are free; order pays from the wallet above, capped at $0.10 per check.
    allowedTools: ["mcp__crosscheck__quote", "mcp__crosscheck__order", "mcp__crosscheck__result"],
  },
})) {
  if (message.type === "result" && message.subtype === "success") console.log(message.result);
}
