// Build the two self-contained bundles the npm package ships (bin/) from src/.
// Rebuilding with the pinned versions in package-lock.json gives the same bytes
// as the published package and the skill, whose checksums are in SHA256SUMS.
import { build } from "esbuild";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const BUNDLES = [
  ["src/cli.ts", "crosscheck.mjs"],
  ["src/mcp.ts", "crosscheck-mcp.mjs"],
];
const banner = [
  "// crosscheck client, bundled from https://crosscheckapi.com. Source: client/src in the crosscheck repository.",
  "import { createRequire as __crosscheckCreateRequire } from 'node:module';",
  "const require = __crosscheckCreateRequire(import.meta.url);",
].join("\n");

/** Bundle into outDir (default client/bin) and return "sha256  file" lines. */
export async function bundle(outDir = join(here, "bin")) {
  mkdirSync(outDir, { recursive: true });
  const sums = [];
  for (const [entry, file] of BUNDLES) {
    const outfile = join(outDir, file);
    await build({
      entryPoints: [join(here, entry)],
      outfile,
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      minify: true,
      legalComments: "none",
      banner: { js: banner },
      logLevel: "warning",
    });
    chmodSync(outfile, 0o755);
    sums.push(`${createHash("sha256").update(readFileSync(outfile)).digest("hex")}  ${file}`);
  }
  return sums;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  for (const line of await bundle()) console.log(line);
}
