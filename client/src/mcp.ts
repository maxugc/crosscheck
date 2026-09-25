#!/usr/bin/env node
// crosscheck MCP server (stdio). Tools: quote, order, accept, skillcheck, result, credits.
// Env: CROSSCHECK_WALLET_KEY (pays for order), CROSSCHECK_MAX_USD (default 0.10), CROSSCHECK_URL.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { clientFromEnv, readSkillDir } from "./core.js";

const client = clientFromEnv();
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const draft = z.string().min(1).max(200_000).describe("The full text you want checked, exactly as your human would see it");
const ref = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/)
  .optional()
  .describe("Optional: the hash of a crosscheck receipt that led you here (the id in its /r/<hash> link). Its wallet earns check credits from your spend; it costs you nothing.");
const credits = z
  .boolean()
  .optional()
  .describe("Optional: pay with your wallet's referral credits (see the credits tool) instead of USDC. If they do not cover the price, USDC is paid as usual.");
const paid = (o: { ref?: string | undefined; credits?: boolean | undefined }) => ({ ...(o.ref ? { ref: o.ref } : {}), ...(o.credits ? { credits: true } : {}) });

serveStdio(() => {
  const server = new McpServer({ name: "crosscheck", version: "0.5.5" }, { capabilities: { tools: {} } });

  server.registerTool(
    "quote",
    {
      title: "Quote a crosscheck review",
      description: "Free. Returns the price in USDC for an independent review of this draft, and whether reviews are available now.",
      inputSchema: z.object({ draft }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ draft }) => text(await client.quote(draft)),
  );

  server.registerTool(
    "order",
    {
      title: "Order a crosscheck review (paid)",
      description:
        "Pays the quoted price (usually $0.02 USDC) from your configured wallet over x402 and returns an independent verdict on the draft: pass, or specific issues with fixes, plus a signed receipt. Use before showing a draft to your human. Pass a Moltbook identity token to use a free check first. If status is pending, call result later with job_id and result_token.",
      inputSchema: z.object({
        draft,
        moltbook_identity: z
          .string()
          .optional()
          .describe("Optional Moltbook identity token (audience crosscheckapi.com) for a free check; each token works once"),
        sources: z
          .array(z.object({ text: z.string(), title: z.string().optional(), url: z.string().optional() }))
          .max(10)
          .optional()
          .describe("Optional: the text the draft relies on (search results, documents). Each claim is then checked against it."),
        ref,
        credits,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ draft, moltbook_identity, sources, ...o }) =>
      text(await client.order(draft, { ...paid(o), ...(moltbook_identity ? { moltbookIdentity: moltbook_identity } : {}), ...(sources ? { sources } : {}) })),
  );

  server.registerTool(
    "accept",
    {
      title: "Check work another agent handed back (paid)",
      description:
        "Pays about $0.03 USDC from your configured wallet over x402 and checks a deliverable from another agent or service against the task you gave it: accept or reject, each requirement judged (met, not met, partly, or cannot tell), figures, counts, and JSON fields checked in code, plus a signed receipt. Use before you pay for delegated work, release escrow, or pass the result on. If status is pending, call result later with job_id and result_token.",
      inputSchema: z.object({
        task: z.string().min(1).max(200_000).describe("The task you gave, with every requirement, exactly as sent"),
        deliverable: z.string().min(1).max(200_000).describe("What came back, exactly as received"),
        reference: z.string().max(200).optional().describe("Optional order id or transaction hash to record on the receipt"),
        payment_tx: z.string().optional().describe("Optional: the transaction you paid the other agent with; crosscheck verifies it on-chain and binds it to the receipt"),
        payment_network: z.string().optional().describe("CAIP-2 network of payment_tx, default eip155:8453"),
        ref,
        credits,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ task, deliverable, reference, payment_tx, payment_network, ...o }) =>
      text(
        await client.accept(task, deliverable, {
          ...paid(o),
          ...(reference ? { reference } : {}),
          ...(payment_tx ? { paymentTx: payment_tx } : {}),
          ...(payment_network ? { paymentNetwork: payment_network } : {}),
        }),
      ),
  );

  server.registerTool(
    "skillcheck",
    {
      title: "Security-check a skill or MCP server before installing it",
      description:
        "Reviews an agent skill or MCP server's files before you install or connect it: downloads piped into a shell, credential and wallet reads, secrets sent over the network, persistence, hidden Unicode, and prompt injection aimed at you or at the scanner. The files are read, never run. Checks the free lookup first; pays about $0.03 USDC only when nobody has scanned these exact files. Pass directory (a local folder) or files. Never says safe: no_findings means nothing was found in these files.",
      inputSchema: z.object({
        directory: z.string().optional().describe("Local folder of the skill or server to scan (dependencies and binaries are skipped)"),
        files: z
          .array(z.object({ path: z.string(), content: z.string() }))
          .max(50)
          .optional()
          .describe("The files to scan, if you have them in hand instead of a folder"),
        fresh: z.boolean().optional().describe("Pay for a new scan even if these exact files were scanned before"),
        ref,
        credits,
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ directory, files, fresh, ...o }) => {
      const input = files ?? (directory ? readSkillDir(directory) : undefined);
      if (!input) throw new Error("Pass directory or files");
      return text(await client.skillcheck(input, { ...paid(o), ...(fresh ? { fresh } : {}) }));
    },
  );

  server.registerTool(
    "credits",
    {
      title: "See referral credits",
      description:
        "Free. Referral credits a wallet has earned (default: your configured wallet). A wallet earns credits when another wallet's first paid check cites one of its receipts as ref. Spend them by passing credits: true to order, accept, or skillcheck.",
      inputSchema: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional().describe("Wallet address; default is your own") }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ address }) => text(await client.credits(address)),
  );

  server.registerTool(
    "result",
    {
      title: "Get a crosscheck result",
      description: "Free. Returns the status, verdict, and verified receipt of an earlier order.",
      inputSchema: z.object({
        job_id: z.string().describe("job_id from the order response"),
        result_token: z.string().describe("result_token from the order response"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ job_id, result_token }) => text(await client.result(job_id, result_token)),
  );

  return server;
});
