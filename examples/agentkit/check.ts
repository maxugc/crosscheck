// Check a draft with crosscheck from a Coinbase AgentKit agent, using AgentKit's own
// x402 action provider: no crosscheck package, the agent's wallet pays.
//
//   npm install
//   CROSSCHECK_WALLET_KEY=0x... npx tsx check.ts ../draft.txt
//
// Set CROSSCHECK_NETWORKS=eip155:84532 to pay with free test USDC on Base Sepolia.
//
// In your own agent, the only line you need is the provider with crosscheck registered:
//   x402ActionProvider({ registeredServices: ["https://crosscheckapi.com"], maxPaymentUsdc: 0.1 })
// The model then calls make_http_request on https://crosscheckapi.com/v1/check with
// {"draft": "..."} and retry_http_request_with_x402 to pay. This script makes the same two calls.
import { readFileSync } from "node:fs";
import { ViemWalletProvider, x402ActionProvider } from "@coinbase/agentkit";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, baseSepolia } from "viem/chains";

// AgentKit 0.10.4 sends a usage event on start and does not catch a failed send
// (coinbase/agentkit#1408); keep that from ending the script.
process.on("unhandledRejection", (e) => console.error("ignored:", e instanceof Error ? e.message : e));

const key = process.env.CROSSCHECK_WALLET_KEY;
if (!key) throw new Error("Set CROSSCHECK_WALLET_KEY to the private key of a dedicated wallet");
const testnet = (process.env.CROSSCHECK_NETWORKS ?? "eip155:8453").split(",")[0]!.trim() === "eip155:84532";

// AgentKit 0.10.4 signs the first payment option the server lists, whatever option you pass
// (coinbase/agentkit#1404). crosscheck lists Base first, so on Base Sepolia pin the network.
const URL = `https://crosscheckapi.com/v1/check${testnet ? "?network=base-sepolia" : ""}`;

const wallet = new ViemWalletProvider(
  createWalletClient({ account: privateKeyToAccount(key as `0x${string}`), chain: testnet ? baseSepolia : base, transport: http() }),
);
const actions = Object.fromEntries(
  x402ActionProvider({ registeredServices: ["https://crosscheckapi.com"], maxPaymentUsdc: 0.1 })
    .getActions(wallet)
    .map((a) => [a.name.replace(/^X402ActionProvider_/, ""), a]),
);

const draft = readFileSync(process.argv[2] ?? 0, "utf8"); // a file, or stdin
const body = { draft };

// 1. Ask: crosscheck answers 402 with the price, the options, and an example request.
const quote = JSON.parse(await actions.make_http_request!.invoke({ url: URL, method: "POST", body }));
const option = quote.acceptablePaymentOptions?.find((o: { network: string }) => o.network === (testnet ? "eip155:84532" : "eip155:8453"));
if (!option) throw new Error(`no payment option for this wallet: ${JSON.stringify(quote).slice(0, 500)}`);
console.error(`price: ${Number(option.amount) / 1e6} USDC on ${option.network}`);

// 2. Pay and get the verdict (settled before the review runs).
const paid = JSON.parse(await actions.retry_http_request_with_x402!.invoke({ url: URL, method: "POST", body, selectedPaymentOption: option }));
// A long review answers 202: paid and queued. AgentKit calls any status but 200 "not settled",
// so read the 202 body instead of trusting that message.
if (paid.status !== "success" && paid.httpStatus !== 202) throw new Error(JSON.stringify(paid).slice(0, 1000));
if (paid.paymentProof) console.error("paid:", paid.paymentProof.transaction);
const result = paid.data;

// Poll a queued review with the result token (free).
let out = result;
while (out.status === "pending") {
  await new Promise((r) => setTimeout(r, (out.retry_after_seconds ?? 5) * 1000));
  out = await (await fetch(result.result_url, { headers: { authorization: `Bearer ${result.result_token}` } })).json();
}
console.log(JSON.stringify(out.verdict ?? out, null, 2));
