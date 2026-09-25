#!/usr/bin/env node
// crosscheck quote|order [file]   (reads the draft from the file, or stdin)
// crosscheck result <job_id> <result_token>
// crosscheck accept <task-file> <deliverable-file> [reference]
// crosscheck skillcheck <skill-or-server-folder> [--fresh]
// crosscheck credits [wallet]
// Paid commands also take --ref <receipt hash> (credits the wallet whose receipt sent you) and
// --credits (pay with your referral credits; USDC only if they do not cover the price).
import { readFileSync } from "node:fs";
import { clientFromEnv, readSkillDir, type PaidOptions } from "./core.js";

const usage =
  "Usage: crosscheck quote|order [draft-file] [--sources files...]  |  crosscheck accept <task-file> <deliverable-file> [reference]  |  crosscheck skillcheck <folder> [--fresh]  |  crosscheck result <job_id> <result_token>  |  crosscheck credits [wallet]\n" +
  "Paid commands (order, accept, skillcheck) also take --ref <receipt hash> and --credits.";

/** Pull --ref <hash> and --credits out of argv; everything else stays in order. */
function paidFlags(argv: string[]): { args: string[]; paid: PaidOptions } {
  const args: string[] = [];
  const paid: PaidOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--credits") paid.credits = true;
    else if (a === "--ref") {
      const v = argv[++i];
      if (!v) throw new Error("--ref needs a receipt hash");
      paid.ref = v;
    } else if (a.startsWith("--ref=")) paid.ref = a.slice(6);
    else args.push(a);
  }
  return { args, paid };
}

async function readDraft(file?: string): Promise<string> {
  if (file) return readFileSync(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { args, paid } = paidFlags(rest);
  const client = clientFromEnv();
  let out: unknown;
  if (cmd === "quote") out = await client.quote(await readDraft(args[0]));
  else if (cmd === "order") {
    // crosscheck order draft.txt --sources a.txt b.txt
    const at = args.indexOf("--sources");
    const sources = at >= 0 ? args.slice(at + 1).map((f) => ({ title: f, text: readFileSync(f, "utf8") })) : [];
    out = await client.order(await readDraft(at === 0 ? undefined : args[0]), { ...paid, ...(sources.length ? { sources } : {}) });
  }
  else if (cmd === "result" && args.length === 2) out = await client.result(args[0]!, args[1]!);
  else if (cmd === "credits" && args.length <= 1) out = await client.credits(args[0]);
  else if (cmd === "skillcheck" && args.length >= 1) {
    out = await client.skillcheck(readSkillDir(args[0]!), { ...paid, ...(args.includes("--fresh") ? { fresh: true } : {}) });
  } else if (cmd === "accept" && (args.length === 2 || args.length === 3)) {
    out = await client.accept(readFileSync(args[0]!, "utf8"), readFileSync(args[1]!, "utf8"), { ...paid, ...(args[2] ? { reference: args[2] } : {}) });
  }
  else {
    console.error(usage);
    process.exit(2);
  }
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
