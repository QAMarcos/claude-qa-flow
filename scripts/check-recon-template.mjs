#!/usr/bin/env node
// The recon template exists twice on purpose: as a file the executor copies
// (skills/manual-test/assets/recon.template.spec.ts — the brief points at it) and as the code block
// in skills/manual-test/references/recon.md (inlined into the packaged agents, which may not know the
// skill's path). This check fails when the two drift apart.
// Usage: node scripts/check-recon-template.mjs        (exit 1 on drift)
//        node scripts/check-recon-template.mjs --fix  (rewrite the block in recon.md from the asset)

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ASSET = join(ROOT, "skills", "manual-test", "assets", "recon.template.spec.ts");
const DOC = join(ROOT, "skills", "manual-test", "references", "recon.md");

const asset = readFileSync(ASSET, "utf8").replace(/\r\n/g, "\n").trimEnd();
const doc = readFileSync(DOC, "utf8").replace(/\r\n/g, "\n");
const block = /(## Template[^\n]*\n[\s\S]*?```ts\n)([\s\S]*?)(\n```)/;
const m = doc.match(block);
if (!m) {
  console.error("recon.md: no ```ts block under the Template heading");
  process.exit(1);
}
if (m[2].trimEnd() === asset) {
  console.log("recon template in sync");
  process.exit(0);
}
if (process.argv.includes("--fix")) {
  writeFileSync(DOC, doc.replace(block, `$1${asset}$3`));
  console.log("recon.md template block rewritten from the asset");
  process.exit(0);
}
console.error("recon.md template block differs from assets/recon.template.spec.ts — run with --fix");
process.exit(1);
