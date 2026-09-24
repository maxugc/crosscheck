# crosscheck in MCP clients

The MCP server is the npm package `crosscheckapi` (Node 20 or later). It has three tools: `quote` (free), `order` (pays and returns the verdict), and `result` (free).

Use the private key of a dedicated wallet holding a few dollars of USDC on Base, never your main wallet. To try it with free test USDC from https://faucet.circle.com, add `CROSSCHECK_NETWORKS=eip155:84532` to the environment.

| Variable | Meaning |
| --- | --- |
| `CROSSCHECK_WALLET_KEY` | Private key of the wallet that pays. Only needed for `order`. |
| `CROSSCHECK_MAX_USD` | Refuse to pay more than this per check. Default `0.10`. |
| `CROSSCHECK_NETWORKS` | Networks to pay on, in order of preference. Default `eip155:8453,eip155:84532`. |

## Claude Code

```bash
claude mcp add crosscheck --scope user -e CROSSCHECK_WALLET_KEY=0xYOUR_DEDICATED_WALLET_KEY -- npx -y crosscheckapi
```

## Claude Desktop, Cursor, Windsurf

Claude Desktop: `claude_desktop_config.json`. Cursor: `~/.cursor/mcp.json` or `.cursor/mcp.json`. Windsurf: `~/.codeium/windsurf/mcp_config.json`.

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

## VS Code

`.vscode/mcp.json`. VS Code asks for the key once and stores it securely, so it never sits in the file.

```json
{
  "inputs": [
    { "type": "promptString", "id": "crosscheck-wallet-key", "description": "Private key of a dedicated crosscheck wallet", "password": true }
  ],
  "servers": {
    "crosscheck": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "crosscheckapi"],
      "env": { "CROSSCHECK_WALLET_KEY": "${input:crosscheck-wallet-key}" }
    }
  }
}
```

## Codex CLI

`~/.codex/config.toml`:

```toml
[mcp_servers.crosscheck]
command = "npx"
args = ["-y", "crosscheckapi"]
env = { CROSSCHECK_WALLET_KEY = "0xYOUR_DEDICATED_WALLET_KEY" }
tool_timeout_sec = 120
```

## Tell the agent when to use it

> Before you give your human any draft that contains numbers, dates, money, or commitments, or that will be sent to someone else, call crosscheck's `order` tool with the full draft exactly as your human will see it. Fix every blocker and major issue it reports. Say the draft was checked only if the verdict passed.

A paid review takes 5 to 30 seconds. If your client has a short tool timeout, raise it to 120 seconds.
