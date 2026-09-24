// Security-check a skill or MCP server folder before you install it. Free if someone
// already scanned these exact files; otherwise it pays about $0.03.
//
//   CROSSCHECK_WALLET_KEY=0x... npx tsx skillcheck.ts path/to/skill
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { postAndWait } from "./pay.js";

const dir = process.argv[2];
if (!dir) throw new Error("Usage: skillcheck.ts <folder>");
const SKIP = new Set(["node_modules", ".git", "dist", "build", "__pycache__", ".venv"]);
const files: Array<{ path: string; content: string }> = [];
const walk = (d: string) => {
  for (const name of readdirSync(d).sort()) {
    const full = join(d, name);
    if (statSync(full).isDirectory()) {
      if (!SKIP.has(name)) walk(full);
    } else {
      const buf = readFileSync(full);
      if (!buf.includes(0) && buf.length <= 200_000) files.push({ path: relative(dir, full).split(sep).join("/"), content: buf.toString("utf8") });
    }
  }
};
walk(dir);

// The bundle hash: SHA-256 of the sorted list of {path, sha256} as canonical JSON.
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const entries = files.map((f) => ({ path: f.path, sha256: sha(f.content) })).sort((a, b) => (a.path < b.path ? -1 : 1));
const bundle = sha(JSON.stringify(entries));

const known = await fetch(`https://crosscheckapi.com/v1/skillcheck/${bundle}`);
const v = known.ok ? await known.json() : (await postAndWait("https://crosscheckapi.com/v1/skillcheck", { files })).verdict;
console.log(`${known.ok ? "(already scanned) " : ""}risk: ${v.risk}. ${v.summary ?? ""}`);
for (const f of v.verdict?.findings ?? v.findings ?? []) console.log(`  ${f.severity.padEnd(8)} ${f.category.padEnd(20)} ${f.file}: ${f.explanation}`);
process.exitCode = v.risk === "critical" || v.risk === "high" ? 1 : 0;
