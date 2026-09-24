#!/usr/bin/env node
// crosscheck quote|order [file]   (reads the draft from the file, or stdin)
// crosscheck result <job_id> <result_token>
import { readFileSync } from "node:fs";
import { clientFromEnv } from "./core.js";

const [cmd, ...args] = process.argv.slice(2);
const usage = "Usage: crosscheck quote|order [draft-file]  |  crosscheck result <job_id> <result_token>";

async function readDraft(file?: string): Promise<string> {
  if (file) return readFileSync(file, "utf8");
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  const client = clientFromEnv();
  let out: unknown;
  if (cmd === "quote") out = await client.quote(await readDraft(args[0]));
  else if (cmd === "order") out = await client.order(await readDraft(args[0]));
  else if (cmd === "result" && args.length === 2) out = await client.result(args[0]!, args[1]!);
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
