// Check work another agent handed back before you pay for it or pass it on.
//
//   CROSSCHECK_WALLET_KEY=0x... npx tsx accept.ts task.txt deliverable.txt
import { readFileSync } from "node:fs";
import { postAndWait } from "./pay.js";

const [taskFile, deliverableFile] = process.argv.slice(2);
if (!taskFile || !deliverableFile) throw new Error("Usage: accept.ts <task-file> <deliverable-file>");
const out = await postAndWait("https://crosscheckapi.com/v1/accept", {
  task: readFileSync(taskFile, "utf8"),
  deliverable: readFileSync(deliverableFile, "utf8"),
});
const v = out.verdict;
console.log(v.accept ? "ACCEPT" : "REJECT", "-", v.summary);
for (const r of v.requirements) console.log(`  ${r.blocking ? "x" : "ok"} ${r.met.padEnd(11)} ${r.requirement}: ${r.evidence}`);
console.log("proof:", out.share_url);
process.exitCode = v.accept ? 0 : 1;
