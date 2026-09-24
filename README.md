# crosscheck

Independent checks for AI agents, paid per call over x402:

- **check**: a second opinion on your agent's draft before your human sees it. $0.02.
- **accept**: a check of work another agent or service hands back, before your agent pays for it, releases escrow, or passes it on. $0.03.
- **skillcheck**: a security review of a skill or MCP server before your agent installs it. $0.03, free for files someone already scanned.

Agents write emails, reports, client messages, and PR descriptions. The agent that wrote a draft is the worst one to check it. crosscheck is a separate reviewer: your agent sends the text and gets back a verdict, either pass or a list of specific issues with fixes, plus an Ed25519-signed receipt.

Each check costs $0.02 in USDC on Base, paid per request over [x402](https://x402.org). There is no account, no API key, and no subscription. You can try it for free with test USDC on Base Sepolia, up to 10 checks per wallet per day.

## What it catches

- **Wrong arithmetic.** The model extracts each calculation and code recomputes it, so a wrong total like "640 + 910 = 1,350" is caught by math, not by a guess.
- **Contradictions** between parts of the draft: dates, names, and amounts that disagree.
- **Leftovers:** `[NAME]` placeholders, TODOs, and content the draft promises but does not contain ("the three options below", followed by one).
- **Leaked secrets** such as API keys and passwords (reported without repeating them).
- **Commitments** your agent may not be allowed to make: discounts, deadlines, refunds.
- **Tone** that does not fit the reader.
- **Prompt injection:** text aimed at an AI reviewer. A draft containing it never passes.

## accept: check work another agent hands back

Agents increasingly buy work from other agents: research, data, code, drafts. The buyer needs to know the work meets the task before it pays. Send the task you gave and the deliverable you got back:

```json
{"task": "List 5 competitors of Acme Robotics as a JSON array. Each item needs name, hq (city), and founded (year).",
 "deliverable": "[{\"name\": \"Northwind Robotics\", \"hq\": \"Denver\", \"founded\": 2011}, {\"name\": \"Globex Automation\", \"hq\": \"Austin\"}]"}
```

You get accept or reject, with every requirement judged:

```json
{"accept": false,
 "summary": "Rejected: 2 of 4 requirements not met. First: List 5 competitors (no).",
 "requirements": [
   {"requirement": "List 5 competitors", "met": "no", "evidence": "Counted 2 items; the task asks for exactly 5 items.", "subjective": false, "blocking": true},
   {"requirement": "Each item needs founded (year)", "met": "partly", "evidence": "Checked all 2 items: \"founded\" is missing in item 2.", "subjective": false, "blocking": true}]}
```

(The two requirements that passed are left out here.) Counts, required JSON fields, and figures are checked in code, not by the model. A deliverable that claims its own completeness, or tries to talk the checker into accepting, never passes. The signed receipt holds hashes of the task and the deliverable and your optional reference (an order id or transaction hash), so both agents can see exactly what was checked.

## skillcheck: scan a skill before you install it

Skills and MCP servers run with your agent's access to files, keys, and money, and malicious ones are common on public registries. skillcheck reads a skill's files (never runs them) and reports what they could do: downloads piped into a shell, reads of SSH keys, cloud credentials, and wallets, environment variables sent over the network, persistence, invisible characters, and instructions aimed at your agent or at the scanner. Code rules catch the known patterns; the review model judges intent against what the skill says it does.

```bash
npx -p crosscheckapi crosscheck skillcheck ~/.claude/skills/some-skill
```

Results are keyed to the SHA-256 of the files, so a skill someone already scanned is looked up free. The verdict never says "safe": `no_findings` means nothing was found in the files sent.

**Skill authors:** scan your own skill and add the `badge_markdown` from the result to your README. The badge links to a signed proof page for that exact version of your files, so agents deciding whether to install it can see it was checked.

## Quick start: MCP

Claude Code:

```bash
claude mcp add crosscheck -e CROSSCHECK_WALLET_KEY=0xYOUR_DEDICATED_WALLET_KEY -- npx -y crosscheckapi
```

Or install the Claude Code plugin, which adds the MCP server and the skill together. Set `CROSSCHECK_WALLET_KEY` in your environment before starting Claude Code; the plugin reads it from there and never stores it:

```text
/plugin marketplace add maxugc/crosscheck
/plugin install crosscheck@crosscheck
```

Any client that takes an `mcpServers` block (Claude Desktop, Cursor, Windsurf, and others):

```json
{
  "mcpServers": {
    "crosscheck": {
      "command": "npx",
      "args": ["-y", "crosscheckapi"],
      "env": { "CROSSCHECK_WALLET_KEY": "0xYOUR_DEDICATED_WALLET_KEY" }
    }
  }
}
```

VS Code, Codex CLI, and other setups are in [examples/mcp](examples/mcp). The server has five tools: `quote` (free), `order` (checks a draft), `accept` (checks work another agent handed back), `skillcheck` (scans a skill or server before install), and `result` (free).

Use a dedicated wallet that holds a few dollars of USDC on Base, never your main wallet. The client refuses any price above `CROSSCHECK_MAX_USD` (default `0.10`). To try it without real money, get test USDC from https://faucet.circle.com and add `"CROSSCHECK_NETWORKS": "eip155:84532"` to `env`.

## Add one line to your agent's instructions

A tool only helps if the agent calls it. Put these in your agent's system prompt:

> Before you give your human any draft that contains numbers, dates, money, or commitments, or that will be sent to someone else, call crosscheck's `order` tool with the full draft exactly as your human will see it. Fix every blocker and major issue it reports. Say the draft was checked only if the verdict passed.

> Before you pay for work another agent or service delivered, or pass it on, call crosscheck's `accept` tool with the task you gave and the deliverable exactly as received. Pay or use it only if accept is true; otherwise send the blocking requirements back.

## Without MCP

Any x402 v2 client works. POST `{"draft": "..."}` to `https://crosscheckapi.com/v1/check`, pay the 402 (scheme `exact`, network `eip155:8453`), and send the same request again with the payment header. Payment settles before the review runs.

- [TypeScript with @x402/fetch](examples/typescript)
- [Python with x402 and httpx](examples/python)
- [OpenAI Agents SDK](examples/openai-agents)
- [LangChain](examples/langchain)
- [Claude Agent SDK](examples/claude-agent-sdk)
- CLI: `npx -p crosscheckapi crosscheck order draft.txt`

The full API is in [skill/crosscheck/references/API.md](skill/crosscheck/references/API.md), and the always-current summary is at https://crosscheckapi.com/llms.txt.

## Example verdict

```json
{
  "pass": false,
  "summary": "One arithmetic error changes the conclusion.",
  "issues": [
    {
      "severity": "major",
      "category": "logic",
      "location": "640 + 910",
      "problem": "The draft gives 1350 for 640 + 910, but it comes to 1,550.",
      "suggestion": "Correct the total to 1,550 and recheck the budget statement."
    }
  ],
  "injection_suspected": false
}
```

`pass` is true when there are no blocker or major issues. Minor issues may still be listed.

## Price

| Draft size | Price |
| --- | --- |
| Up to 12,000 units (about 12,000 English characters) | $0.02 |
| Each further 12,000 units | +$0.01 |
| Maximum | 48,000 units, $0.05 |

A unit is one character, or half the UTF-8 byte length when that is larger, so most non-Latin text and emoji count 1.5 to 2 units per character. A quote is free. A pass costs the same as a fail.

## Receipts

Every paid check returns a receipt covering the SHA-256 of your draft (never the text), the payment, and the SHA-256 of the verdict. It is signed with Ed25519 and chained into an append-only ledger. Each result also comes with a `share_url`, a public page showing the outcome, time, payment, and hashes (never your text), so an agent can link proof that its work was checked. The client verifies it automatically against https://crosscheckapi.com/.well-known/crosscheck-keys.json and reports `receipt_check.valid`, so you can show your human proof of what was checked and when.

## Privacy

The draft is sent to crosscheck and to its review model (Claude, through Anthropic's API), then deleted when the check finishes. Only its hash is kept. Verdicts are kept for 30 days so you can fetch them again, then deleted. Do not send text your human has marked confidential.

## What is in this repository

- [client/](client): source of the npm package [`crosscheckapi`](https://www.npmjs.com/package/crosscheckapi), the MCP server and CLI. `npm ci && npm run build` rebuilds `bin/` byte for byte, matching the checksums in [skill/crosscheck/SHA256SUMS](skill/crosscheck/SHA256SUMS).
- [skill/crosscheck/](skill/crosscheck): an [Agent Skill](https://agentskills.io) with `SKILL.md`, the API reference, and the bundled client. Install it with one command:
  ```bash
  mkdir -p ~/.claude/skills && curl -fsSL https://crosscheckapi.com/crosscheck-skill.tar.gz | tar -xz -C ~/.claude/skills
  ```
- [examples/](examples): MCP configs and framework examples.
- [server.json](server.json): the [MCP Registry](https://registry.modelcontextprotocol.io) entry, `com.crosscheckapi/crosscheck`.

The review service itself is not in this repository.

## Listings

[x402 Bazaar](https://docs.cdp.coinbase.com/x402/bazaar) · [MCP Registry](https://registry.modelcontextprotocol.io/v0/servers?search=crosscheck) · [npm](https://www.npmjs.com/package/crosscheckapi) · [ClawHub](https://clawhub.ai/maxugc/crosscheck) · [llms.txt](https://crosscheckapi.com/llms.txt) · [OpenAPI](https://crosscheckapi.com/openapi.json)

## License

MIT
