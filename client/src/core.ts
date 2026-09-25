import { decodePaymentResponseHeader, wrapFetchWithPayment, x402Client } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
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
  async order(draft: string, opts: { moltbookIdentity?: string; sources?: Array<string | { text: string; title?: string | undefined; url?: string | undefined }> } = {}): Promise<Json> {
    const request = { draft, ...(opts.sources && opts.sources.length ? { sources: opts.sources } : {}) };
    const identity = opts.moltbookIdentity ? { "x-moltbook-identity": opts.moltbookIdentity } : {};
    if (!this.opts.privateKey) {
      if (!opts.moltbookIdentity) throw new Error("A wallet private key is required to pay (set CROSSCHECK_WALLET_KEY), or pass a Moltbook identity token for a free check.");
      const res = await this.post("/v1/check", request, this.fetchImpl, identity);
      const body = (await res.json().catch(() => ({}))) as Json;
      const out: Json = { http_status: res.status, ...body };
      const denied = res.headers.get("x-crosscheck-free-tier");
      if (denied) out.free_tier_denied = denied;
      if (body.receipt) out.receipt_check = await this.verifyReceipt(body.receipt as Json, body.verdict as Json | undefined);
      return out;
    }
    return this.paidPost("/v1/check", request, identity);
  }

  /** Free. Price for an accept check of this handoff. */
  async acceptQuote(task: string, deliverable: string): Promise<Json> {
    const res = await this.post("/v1/accept/quote", { task, deliverable });
    return { http_status: res.status, ...((await res.json()) as Json) };
  }

  /**
   * Paid. Check a deliverable another agent handed back against the task it was given,
   * before paying it, releasing escrow, or passing the work on. Returns accept or reject
   * with each requirement judged, and a signed receipt.
   */
  async accept(task: string, deliverable: string, opts: { reference?: string; paymentTx?: string; paymentNetwork?: string } = {}): Promise<Json> {
    if (!this.opts.privateKey) throw new Error("A wallet private key is required to pay (set CROSSCHECK_WALLET_KEY).");
    const body = {
      task,
      deliverable,
      ...(opts.reference ? { reference: opts.reference } : {}),
      ...(opts.paymentTx ? { payment_tx: opts.paymentTx, ...(opts.paymentNetwork ? { payment_network: opts.paymentNetwork } : {}) } : {}),
    };
    return this.paidPost("/v1/accept", body, {});
  }

  private async paidPost(path: string, body: unknown, extraHeaders: Record<string, string>): Promise<Json> {
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
    const res = await this.post(path, body, pay, extraHeaders);
    const reply = (await res.json()) as Json;
    const header = res.headers.get("payment-response");
    const out: Json = { http_status: res.status, ...reply };
    if (header) out.payment = decodePaymentResponseHeader(header);
    if (reply.receipt) out.receipt_check = await this.verifyReceipt(reply.receipt as Json, reply.verdict as Json | undefined);
    return out;
  }

  /** Free. The latest paid skillcheck of this exact bundle, if anyone has scanned it. */
  async skillLookup(bundleSha: string): Promise<Json> {
    if (!/^[0-9a-f]{64}$/.test(bundleSha)) throw new Error("bundle hash must be 64 lowercase hex characters");
    const res = await this.fetchImpl(`${this.baseUrl}/v1/skillcheck/${bundleSha}`);
    return { http_status: res.status, ...((await res.json()) as Json) };
  }

  /**
   * Security review of a skill or MCP server's files before you install or connect it. Checks the
   * free lookup first and pays (about $0.03) only when nobody has scanned these exact files, unless
   * fresh is true. Never says safe: "no_findings" means nothing was found in these files.
   */
  async skillcheck(files: SkillFile[], opts: { fresh?: boolean } = {}): Promise<Json> {
    if (!opts.fresh) {
      const known = await this.skillLookup(bundleSha256(files));
      if (known.found === true) return { ...known, from_lookup: true };
    }
    if (!this.opts.privateKey) throw new Error("A wallet private key is required to pay (set CROSSCHECK_WALLET_KEY).");
    return this.paidPost("/v1/skillcheck", { files }, {});
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

export interface SkillFile {
  path: string;
  content: string;
}

/** The service's bundle hash: SHA-256 of the canonical list of {path, sha256}, sorted by path. */
export function bundleSha256(files: SkillFile[]): string {
  const entries = files.map((f) => ({ path: f.path, sha256: sha256(f.content) })).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return sha256(canonicalize(entries));
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv", "venv", ".next", "target"]);
const MAX_FILES = 200;
/** The service's limit for a whole bundle; its code rules read all of it, however large a file is. */
const MAX_BUNDLE_BYTES = 3_000_000;

/**
 * Read a skill or server folder's text files, skipping dependencies, build output, and binaries.
 * Large text files are included, never skipped silently: a payload hidden in a big file is exactly
 * what a scan must see.
 */
export function readSkillDir(dir: string): SkillFile[] {
  const out: SkillFile[] = [];
  let bytes = 0;
  const walk = (d: string) => {
    for (const name of readdirSync(d).sort()) {
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (!SKIP_DIRS.has(name)) walk(full);
        continue;
      }
      if (!st.isFile()) continue;
      const buf = readFileSync(full);
      if (buf.includes(0)) continue; // binary
      bytes += buf.length;
      if (bytes > MAX_BUNDLE_BYTES) throw new Error(`${dir} has more than ${MAX_BUNDLE_BYTES} bytes of text; send the files that run or instruct the agent`);
      out.push({ path: relative(dir, full).split(sep).join("/"), content: buf.toString("utf8") });
      if (out.length > MAX_FILES) throw new Error(`${dir} has more than ${MAX_FILES} text files; send the ones that run or instruct the agent`);
    }
  };
  walk(dir);
  if (out.length === 0) throw new Error(`No text files found in ${dir}`);
  return out;
}
