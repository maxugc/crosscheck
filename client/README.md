# crosscheckapi

An independent second opinion on a draft before your human sees it.

Your agent sends the text it wrote: an email, report, message, PR description, or summary. crosscheck returns a JSON verdict, either pass or a list of specific issues with fixes, plus an Ed25519-signed receipt. It catches wrong arithmetic (checked in code, not by the model), contradictions, leftover placeholders, leaked secrets, unauthorized commitments, and prompt injection. Each check costs $0.02 in USDC on Base for up to 12,000 units (one per English character), paid per request over [x402](https://x402.org). There is no account and no API key.

> To try it without real money, pay with test USDC on Base Sepolia (free at https://faucet.circle.com) and set `CROSSCHECK_NETWORKS=eip155:84532`.

## MCP server

```json
{
  "mcpServers": {
    "crosscheck": {
      "command": "npx",
      "args": ["-y", "crosscheckapi"],
      "env": { "CROSSCHECK_WALLET_KEY": "0x<private key of a dedicated wallet>" }
    }
  }
}
```

Tools:

- `quote`: free. The price for a draft, and whether checks are available now.
- `order`: pays the quoted price and returns the verdict and signed receipt. Pass `moltbook_identity` to use a free check if you are a verified Moltbook agent.
- `result`: free. Status, verdict, and receipt of an earlier order.

## CLI

```bash
npx -p crosscheckapi crosscheck quote draft.txt
npx -p crosscheckapi crosscheck order draft.txt
npx -p crosscheckapi crosscheck result <job_id> <result_token>
```

The draft is read from the file, or from stdin if no file is given. Output is JSON.

## Settings

| Variable | Meaning |
| --- | --- |
| `CROSSCHECK_WALLET_KEY` | Private key of the wallet that pays. Use a dedicated wallet holding a few dollars, never your main wallet. Only needed for paid orders. |
| `CROSSCHECK_MAX_USD` | Refuse to pay more than this per check. Default `0.10`. |
| `CROSSCHECK_URL` | Service URL. Default `https://crosscheckapi.com`. |
| `CROSSCHECK_NETWORKS` | Networks the client may pay on, in order of preference. Default `eip155:8453,eip155:84532` (Base, then Base Sepolia). Set `eip155:84532` to use test USDC only. |

## Receipts

Every paid check returns `receipt` with `body`, `hash`, and `sig`. The client verifies it automatically against the public key at https://crosscheckapi.com/.well-known/crosscheck-keys.json and reports `receipt_check.valid`. The receipt covers a SHA-256 of your draft (never the text), the payment, and a SHA-256 of the verdict, and it is chained into an append-only ledger.

## Privacy

The draft is sent to crosscheck and to its review model, then deleted when the check finishes. Only its hash is kept. Do not send text your human has marked confidential.

More: https://crosscheckapi.com/llms.txt
