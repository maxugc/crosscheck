// Shared setup for the examples: a fetch that pays x402 challenges from your wallet,
// only on the networks you allow and never above $0.10 a call.
import { wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";

// Networks you will pay on, in order of preference. Default: Base. Set CROSSCHECK_NETWORKS=eip155:84532 for free test USDC.
const NETWORKS = (process.env.CROSSCHECK_NETWORKS ?? "eip155:8453").split(",").map((n) => n.trim());
const MAX_ATOMIC = 100_000n; // $0.10 (USDC has 6 decimals)

export function payingFetch(): typeof fetch {
  const key = process.env.CROSSCHECK_WALLET_KEY;
  if (!key) throw new Error("Set CROSSCHECK_WALLET_KEY to the private key of a dedicated wallet");
  const pick = <T extends { network: string }>(options: T[]) => NETWORKS.map((n) => options.find((o) => o.network === n)).find(Boolean);
  const client = new x402Client((_version, options) => pick(options) ?? options[0]!);
  registerExactEvmScheme(client, { signer: privateKeyToAccount(key as `0x${string}`) });
  client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
    if (!NETWORKS.includes(r.network)) return { abort: true, reason: `crosscheck does not offer ${NETWORKS.join(", ")}` };
    if (BigInt(r.amount) > MAX_ATOMIC) return { abort: true, reason: `price ${r.amount} is above the limit` };
    return undefined;
  });
  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}

/** POST a paid request and wait for the result (a 202 means paid and queued). */
export async function postAndWait(url: string, body: unknown): Promise<Record<string, any>> {
  const res = await payingFetch()(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  let out = (await res.json()) as Record<string, any>;
  if (res.status !== 200 && res.status !== 202) throw new Error(`crosscheck returned ${res.status}: ${JSON.stringify(out)}`);
  const { result_url, result_token } = out;
  while (out.status === "pending") {
    await new Promise((r) => setTimeout(r, (out.retry_after_seconds ?? 5) * 1000));
    out = await (await fetch(result_url, { headers: { authorization: `Bearer ${result_token}` } })).json();
  }
  return out;
}
