import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createHash, createPublicKey, verify } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";

/**
 * crosscheck client: quote, order (pays over x402 with your own wallet), and
 * result, plus offline verification of the signed receipt.
 */

export const DEFAULT_URL = "https://crosscheckapi.com";
/** Networks the client will pay on, in order of preference: Base, then Base Sepolia (testnet). */
export const DEFAULT_NETWORKS = ["eip155:8453", "eip155:84532"];

export interface ClientOptions {
  baseUrl?: string;
  /** 0x-prefixed EVM private key that pays for checks. Needed only for order(). */
  privateKey?: string;
  /** Refuse to pay more than this per check. Default $0.10. */
  maxUsd?: number;
  /**
   * Networks this client may pay on, in order of preference. Default: Base,
   * then Base Sepolia. The first one the service offers is used.
   */
  networks?: string[];
  fetch?: typeof globalThis.fetch;
}

export interface ReceiptCheck {
  valid: boolean;
  reason?: string;
  key_id?: string;
}

type Json = Record<string, unknown>;

export function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const o = value as Json;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) throw new TypeError("non-finite number");
  return JSON.stringify(value);
}

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

export class CrosscheckClient {
  readonly baseUrl: string;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly opts: ClientOptions;

  constructor(opts: ClientOptions = {}) {
    this.opts = opts;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_URL).replace(/\/+$/, "");
    this.fetchImpl = opts.fetch ?? globalThis.fetch;
  }

  private async post(path: string, body: unknown, f = this.fetchImpl, extraHeaders: Record<string, string> = {}) {
    return f(`${this.baseUrl}${path}`, { method: "POST", headers: { "content-type": "application/json", ...extraHeaders }, body: JSON.stringify(body) });
  }

  /** Free. Price and availability for this draft. */
  async quote(draft: string): Promise<Json> {
    const res = await this.post("/v1/quote", { draft });
    return { http_status: res.status, ...((await res.json()) as Json) };
  }

  /**
   * Paid, or free with a Moltbook identity token. With a token, a free check
   * is tried first; if it is refused, the quoted price is paid (when a wallet
   * is configured).
   */
  async order(draft: string, opts: { moltbookIdentity?: string } = {}): Promise<Json> {
    const identity = opts.moltbookIdentity ? { "x-moltbook-identity": opts.moltbookIdentity } : {};
    if (!this.opts.privateKey) {
      if (!opts.moltbookIdentity) throw new Error("A wallet private key is required to pay (set CROSSCHECK_WALLET_KEY), or pass a Moltbook identity token for a free check.");
      const res = await this.post("/v1/check", { draft }, this.fetchImpl, identity);
      const body = (await res.json().catch(() => ({}))) as Json;
      const out: Json = { http_status: res.status, ...body };
      const denied = res.headers.get("x-crosscheck-free-tier");
      if (denied) out.free_tier_denied = denied;
      if (body.receipt) out.receipt_check = await this.verifyReceipt(body.receipt as Json, body.verdict as Json | undefined);
      return out;
    }
    const account = privateKeyToAccount(this.opts.privateKey as `0x${string}`);
    const maxAtomic = BigInt(Math.round((this.opts.maxUsd ?? 0.1) * 1e6));
    const allowed = this.opts.networks ?? DEFAULT_NETWORKS;
    // Pick the most preferred allowed network the service offers.
    const client = new x402Client((_version, options) => {
      for (const network of allowed) {
        const match = options.find((o) => o.network === network);
        if (match) return match;
      }
      return options[0]!; // refused below, since it is not an allowed network
    });
    registerExactEvmScheme(client, { signer: account });
    client.onBeforePaymentCreation(async ({ selectedRequirements: r }) => {
      if (!allowed.includes(r.network)) return { abort: true, reason: `refusing to pay on ${r.network}; allowed: ${allowed.join(", ")}` };
      if (BigInt(r.amount) > maxAtomic) return { abort: true, reason: `price ${r.amount} exceeds the limit of ${maxAtomic} atomic USDC` };
      return undefined;
    });
    const pay = wrapFetchWithPayment(this.fetchImpl, client);
    const res = await this.post("/v1/check", { draft }, pay, identity);
    const body = (await res.json()) as Json;
    const header = res.headers.get("payment-response");
    const out: Json = { http_status: res.status, ...body };
    if (header) out.payment = decodePaymentResponseHeader(header);
    if (body.receipt) out.receipt_check = await this.verifyReceipt(body.receipt as Json, body.verdict as Json | undefined);
    return out;
  }

  /** Free. Status, verdict, and receipt of an earlier order. */
  async result(jobId: string, resultToken: string): Promise<Json> {
    if (!/^chk_[0-9a-f]{32}$/.test(jobId)) throw new Error("job_id looks wrong; expected chk_ followed by 32 hex characters");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/checks/${jobId}`, { headers: { authorization: `Bearer ${resultToken}` } });
    const body = (await res.json()) as Json;
    const out: Json = { http_status: res.status, ...body };
    if (body.receipt) out.receipt_check = await this.verifyReceipt(body.receipt as Json, body.verdict as Json | undefined);
    return out;
  }

  /** Verify a receipt's hash and Ed25519 signature, and that it covers this verdict. */
  async verifyReceipt(receipt: Json, verdict?: Json): Promise<ReceiptCheck> {
    try {
      const body = receipt.body as Json;
      const bytes = canonicalize(body);
      if (sha256(bytes) !== receipt.hash) return { valid: false, reason: "hash does not match receipt body" };
      const keys = ((await (await this.fetchImpl(`${this.baseUrl}/.well-known/crosscheck-keys.json`)).json()) as { keys: Json[] }).keys;
      const jwk = keys.find((k) => k.kid === body.key_id);
      if (!jwk) return { valid: false, reason: `signing key ${String(body.key_id)} not published` };
      const key = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x as string }, format: "jwk" });
      if (!verify(null, Buffer.from(bytes, "utf8"), key, Buffer.from(receipt.sig as string, "base64url"))) {
        return { valid: false, reason: "bad signature" };
      }
      const review = body.review as Json | undefined;
      if (verdict && review && sha256(canonicalize(verdict)) !== review.verdict_sha256) {
        return { valid: false, reason: "verdict does not match the receipt" };
      }
      return { valid: true, key_id: body.key_id as string };
    } catch (e) {
      return { valid: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function clientFromEnv(env: NodeJS.ProcessEnv = process.env): CrosscheckClient {
  const maxUsd = env.CROSSCHECK_MAX_USD ? Number(env.CROSSCHECK_MAX_USD) : undefined;
  return new CrosscheckClient({
    ...(env.CROSSCHECK_URL ? { baseUrl: env.CROSSCHECK_URL } : {}),
    ...(env.CROSSCHECK_WALLET_KEY ? { privateKey: env.CROSSCHECK_WALLET_KEY.trim() } : {}),
    ...(maxUsd !== undefined && Number.isFinite(maxUsd) ? { maxUsd } : {}),
    // CROSSCHECK_NETWORKS: comma-separated allowlist in order of preference, e.g. "eip155:84532" for testnet only.
    ...(env.CROSSCHECK_NETWORKS ? { networks: env.CROSSCHECK_NETWORKS.split(",").map((x) => x.trim()).filter(Boolean) } : {}),
  });
}
