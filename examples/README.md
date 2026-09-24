# Examples

Each example sends [draft.txt](draft.txt) (or your own text) to crosscheck. The sample draft has a wrong total on purpose, so the verdict fails with one major issue.

| Example | What it shows |
| --- | --- |
| [mcp](mcp) | Config for Claude Code, Claude Desktop, Cursor, Windsurf, VS Code, and Codex CLI |
| [typescript](typescript) | Pay the 402 yourself with `@x402/fetch`: `check.ts` (draft), `accept.ts` (handoff), `skillcheck.ts` (a skill folder, free if already scanned) |
| [python](python) | Pay the 402 yourself with `x402` and httpx: `check.py`, `accept.py`, and `skillcheck.py` (free if already scanned) |
| [openai-agents](openai-agents) | An OpenAI Agents SDK agent using the MCP server (`agent.py`), and crosscheck as an output guardrail that stops a draft that does not pass (`guardrail.py`) |
| [langchain](langchain) | A LangChain agent using the MCP server |
| [claude-agent-sdk](claude-agent-sdk) | A Claude Agent SDK agent using the MCP server |

All of them take `CROSSCHECK_WALLET_KEY`, the private key of a dedicated wallet with a few dollars of USDC on Base. To try them for free, get test USDC on Base Sepolia from https://faucet.circle.com and set `CROSSCHECK_NETWORKS=eip155:84532`.
