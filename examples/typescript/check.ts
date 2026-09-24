// Check a draft with crosscheck from TypeScript, paying over x402 with your own wallet.
//
//   npm install
//   CROSSCHECK_WALLET_KEY=0x... npx tsx check.ts ../draft.txt
//
// Set CROSSCHECK_NETWORKS=eip155:84532 to pay with free test USDC on Base Sepolia.
import { readFileSync } from "node:fs";
import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

const URL = "https://crosscheckapi.com/v1/check";
// Networks you will pay on, in order of preference. Default: Base.
const NETWORKS = (process.env.CROSSCHECK_NETWORKS ?? "eip155:8453").split(",").map((n) => n.trim());
const MAX_ATOMIC = 100_000n; // never pay more than $0.10 (USDC has 6 decimals)

const key = process.env.CROSSCHECK_WALLET_KEY;
if (!key) throw new Error("Set CROSSCHECK_WALLET_KEY to the private key of a dedicated wallet");

// Pay only on NETWORKS, and refuse anything above MAX_ATOMIC.
const pick = <T extends { network: string }>(options: T[]) => NETWORKS.map((n) => options.find((o) => o.network === n)).find(Boolean);
const client = new x402Client((_version, options) => pick(options) ?? options[0]!);
registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });
client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
  if (!NETWORKS.includes(r.network)) return { abort: true, reason: `crosscheck does not offer ${NETWORKS.join(", ")}` };
  if (BigInt(r.amount) > MAX_ATOMIC) return { abort: true, reason: `price ${r.amount} is above the limit` };
  return undefined;
});
const payingFetch = wrapFetchWithPayment(fetch, client);

const draft = readFileSync(process.argv[2] ?? 0, "utf8"); // a file, or stdin
const res = await payingFetch(URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ draft }),
});
let body = (await res.json()) as Record<string, any>;
if (res.status !== 200 && res.status !== 202) throw new Error(`crosscheck returned ${res.status}: ${JSON.stringify(body)}`);

const payment = res.headers.get("payment-response");
if (payment) console.error("paid:", decodePaymentResponseHeader(payment).transaction);

// 202 means paid and queued. Poll the result with the token (free).
const { result_url, result_token } = body;
while (body.status === "pending") {
  await new Promise((r) => setTimeout(r, (body.retry_after_seconds ?? 5) * 1000));
  body = await (await fetch(result_url, { headers: { authorization: `Bearer ${result_token}` } })).json();
}

console.log(JSON.stringify(body.verdict ?? body, null, 2));
process.exitCode = body.verdict?.pass ? 0 : 1;
