#!/usr/bin/env node
// crosscheck MCP server (stdio). Tools: quote, order, accept, skillcheck, result.
// Env: CROSSCHECK_WALLET_KEY (pays for order), CROSSCHECK_MAX_USD (default 0.10), CROSSCHECK_URL.
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";
import { clientFromEnv, readSkillDir } from "./core.js";

const client = clientFromEnv();
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] });
const draft = z.string().min(1).max(200_000).describe("The full text you want checked, exactly as your human would see it");

serveStdio(() => {
  const server = new McpServer({ name: "crosscheck", version: "0.5.4" }, { capabilities: { tools: {} } });

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
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ draft, moltbook_identity, sources }) =>
      text(await client.order(draft, { ...(moltbook_identity ? { moltbookIdentity: moltbook_identity } : {}), ...(sources ? { sources } : {}) })),
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
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ task, deliverable, reference, payment_tx, payment_network }) =>
      text(
        await client.accept(task, deliverable, {
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
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ directory, files, fresh }) => {
      const input = files ?? (directory ? readSkillDir(directory) : undefined);
      if (!input) throw new Error("Pass directory or files");
      return text(await client.skillcheck(input, fresh ? { fresh } : {}));
    },
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
