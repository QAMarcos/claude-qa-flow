#!/usr/bin/env node
// Regression cases for skills/scan-regression-candidates/scripts/inventory.mjs, built from what broke
// on a real scratch root: tickets in folder names, optional-prefix ids in logs, verdicts in comment
// drafts, dates in names vs. mtimes, and folders that must never be read.
// Usage: node scripts/test-inventory.mjs   (exit 1 on any failing case)

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const INVENTORY = join(ROOT, "skills", "scan-regression-candidates", "scripts", "inventory.mjs");

const spec = (title, path) =>
  `import { test, expect } from "@playwright/test";\ntest("${title}", async ({ page }) => {\n  await page.goto("https://staging.app.example.com${path}?session=abc");\n  await test.step("open", async () => {});\n  await expect(page).toHaveURL(/x/);\n});\n`;

const FILES = {
  "scripts/sc14001-retest/recon.spec.ts": spec("recon: settings", "/account-settings"),
  "scripts/sc14001-retest/run.spec.ts": spec("saved filters persist", "/account-settings/billing"),
  "scripts/_manual-14002-01-name-search.spec.ts": spec("search ignores accents", "/people/search"),
  "scripts/_probe-random.spec.ts": spec("probe", "/"),
  "logs/run-97001-record.log": "record 97001 loaded",
  "logs/sc14001-2026-10-02-retest.log": "ok",
  "evidence/sc14002-2026-09-12/step-1.png": "png",
  "evidence/sc14001-retest/comment-draft.md": "**QA retest — saved filters persist — PASS**\n",
  "evidence/sc14002-2026-09-12/card-comment.md": "Retest: FAIL. Accents still break search.\n",
  "secrets/token.txt": "ghp_should_never_be_read",
  "state/user-a.json": "{\"cookies\":[]}",
  "scripts/sc14001-retest/state/user.json": "{\"cookies\":[]}",
  "allure-results/x-attachment.md": "Verdict: PASS",
  "scripts/.env.local": "PASSWORD=x",
  // Phase 3 review — PII in free text and paths, manual-test's own report format, duplicates, order
  "scripts/sc14003-invite.spec.ts":
    `import { test } from "@playwright/test";\ntest("invite jane.doe@gmail.com and call +1 (305) 555-0199", async ({ page }) => {\n  await page.goto("/invite/eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig");\n  await page.goto("/people/jane.doe@gmail.com/profile");\n  await test.step("open record 123456789", async () => {});\n});\n`,
  "evidence/sc14003-2026-10-01/report.md": "Manual test — sc14003 | staging | FAIL\n",
  "evidence/sc14003-2026-10-05/report.md": "Manual test — sc14003 | staging | PASS\n",
  "evidence/sc14004/comment-v1.md": "QA retest — PASS\nQA retest — PASS\nQA retest — PASS\n",
  "evidence/sc14005/review-summary.md": "Run result: BLOCKED by a known bug\n",
  "scripts/_manual-layout-1280.spec.ts": spec("layout at 1280", "/search"),
  // end-to-end re-scan — what still went wrong on real data
  "scripts/sc14006-02-03-run.spec.ts": spec("run with a number pair after the ticket", "/search"),
  "evidence/sc14007/retest-console.txt": "QA retest — PASS\n",
  "logs/sc14007-retest-run.log": "Status 'failed' provided for 1 events\nQA retest result FAIL\n",
  "evidence/sc14008/results-checks.json": '[{"check":"a","result":"FAIL"},{"check":"b","status":"PASS"}]',
  "evidence/sc14009-2026-10-10/comment-a.md": "QA retest — PASS\n",
  "evidence/sc14009-2026-10-10/comment-b.md": "QA retest — FAIL\n",
  "scripts/_fcb2-03-checkout.spec.ts": spec("checkout", "/checkout"),
  "scripts/_fcb5-01-cancel.spec.ts": spec("cancel", "/account"),
  // final Phase 3 review — saved manual-test results, private names in paths, keys in titles
  "reports/sc14010-saved-filters.json": '{"verdict":"FAIL","steps":[{"id":1,"status":"PASS"}],"reviewer_verdict":"PASS","accepted_steps":[1],"reviewed_at":"2026-10-21"}',
  "evidence/sc14011-jane.doe@gmail.com/comment.md": "QA retest — PASS\n",
  "scripts/sc14012-keys.spec.ts":
    `import { test } from "@playwright/test";\ntest("login with pass Hunter2Secret and key AKIAABCDEFGHIJKLMNOP", async ({ page }) => {});\n`,
  "evidence/sc14013/pass-fail-summary.md": "QA retest — PASS\n",
  // confirmation review — slugs kept, reviewed vs. unreviewed verdicts, emails in group keys
  "reports/sc14014-checkout-retest-2026-10-20.json": '{"reviewer_verdict":"PARTIAL","reviewed_at":"2026-10-20"}',
  "evidence/sc14014-2026-10-22/comment.md": "QA retest — PASS\n",
  "scripts/jane.doe@example.com/probe.spec.ts": spec("probe", "/"),
};

const dir = mkdtempSync(join(tmpdir(), "qa-inv-"));
const root = join(dir, "_local");
for (const [rel, content] of Object.entries(FILES)) {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), content);
}
const run = (extra) => {
  const r = spawnSync(process.execPath, [INVENTORY, root, "--ticket", String.raw`(?:sc-?)?\d{5}`, ...extra], { encoding: "utf8" });
  return { status: r.status, out: r.status === 0 ? JSON.parse(r.stdout) : null, err: r.stderr };
};

const a = run(["--id-range", "10000-19999"]);
const b = run([]);
const c = run(["--id-range", "10000-19999", "--since", "2026-10-01"]);
const e = run(["--top", "1"]);
const d = (() => { // default ticket pattern, and --out into a folder that does not exist yet
  const out = join(dir, "new", "folder", "inventory.json");
  const r = spawnSync(process.execPath, [INVENTORY, root, "--out", out], { encoding: "utf8" });
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(out, "utf8")); } catch { /* missing */ }
  return { status: r.status, out: parsed };
})();
rmSync(dir, { recursive: true, force: true });

const g = (res, key) => res.out?.groups.find((x) => x.key === key);
const CASES = [
  ["runs", () => a.status === 0],
  ["ticket taken from the folder name (#14001 has both specs)", () => g(a, "#14001")?.specs === 2],
  ["ticket taken from a `_manual-14002-…` file name", () => g(a, "#14002")?.specs === 1],
  ["evidence folder with ticket + date groups with the ticket", () => g(a, "#14002")?.evidence_dirs === 1],
  ["verdict found in a comment draft (bold line)", () => g(a, "#14001")?.verdicts.PASS === 1],
  ["verdict found in a card comment (Retest: FAIL.)", () => g(a, "#14002")?.verdicts.FAIL === 1],
  ["date from the folder name wins over mtime", () => g(a, "#14002")?.first_seen === "2026-09-12"],
  ["--id-range drops a record id from logs", () => !g(a, "#97001")],
  ["without --id-range the record id becomes a group (documented risk)", () => Boolean(g(b, "#97001"))],
  ["secrets/, state/ (nested too), allure-results/ skipped", () =>
    ["secrets", "state", "scripts/sc14001-retest/state", "allure-results"].every((d) => a.out.totals.skipped_dirs.includes(d))],
  ["sensitive file names skipped", () => a.out.totals.skipped_sensitive >= 1],
  ["nothing from secret files leaks into the output", () => !JSON.stringify(a.out).includes("ghp_should_never_be_read")],
  ["query strings and origins stripped from paths", () => g(a, "#14001")?.paths.every((p) => !p.includes("?") && !p.includes("http"))],
  ["no email, phone, token or long number survives in titles, steps or paths", () => {
    const s = JSON.stringify(g(a, "#14003"));
    return !/jane\.doe|gmail|555-0199|eyJhbGci|123456789/.test(s);
  }],
  ["manual-test's own header is read as a verdict, latest one wins", () =>
    g(a, "#14003")?.verdicts.FAIL === 1 && g(a, "#14003")?.verdicts.PASS === 1 && g(a, "#14003")?.latest_verdict?.verdict === "PASS"],
  ["the same verdict three times in one file counts once", () => g(a, "#14004")?.verdicts.PASS === 1],
  ["BLOCKED is a verdict too", () => g(a, "#14005")?.verdicts.BLOCKED === 1],
  ["--out creates its folder", () => d.status === 0 && d.out !== null],
  ["a number pair after the ticket is not a date (`sc14006-02-03`)", () => g(a, "#14006")?.specs === 1],
  ["run logs are not parsed as reports (`Status 'failed'` is noise)", () => g(a, "#14007")?.verdicts.FAIL === undefined && g(a, "#14007")?.verdicts.PASS === 1],
  ["per-check JSON results are not run verdicts", () => !g(a, "#14008") || Object.keys(g(a, "#14008").verdicts).length === 0],
  ["same-day tie: the cautious verdict wins", () => g(a, "#14009")?.latest_verdict?.verdict === "FAIL"],
  ["unticketed families group together (`_fcb2-…`, `_fcb5-…` → fcb)", () => g(a, "fcb")?.specs === 2],
  ["saved manual-test results in reports/ are read; the reviewer's verdict decides", () =>
    g(a, "#14010")?.reviewed === true && g(a, "#14010")?.latest_verdict?.verdict === "PASS" && g(a, "#14010")?.verdicts.FAIL === undefined],
  ["an email in a folder name is redacted in every path field", () => {
    const s = JSON.stringify(g(a, "#14011"));
    return Boolean(s) && !/jane\.doe|gmail/.test(s);
  }],
  ["a password and an AWS key in a title are redacted", () => !/Hunter2Secret|AKIAABCDEFGHIJKLMNOP/.test(JSON.stringify(g(a, "#14012")))],
  ["a `pass-fail-summary.md` report keeps its name", () => g(a, "#14013")?.reports.some((r) => r.endsWith("pass-fail-summary.md"))],
  ["a hyphenated slug in a path stays readable", () => g(a, "#14014")?.reports.some((r) => r.includes("sc14014-checkout-retest-2026-10-20"))],
  ["a later unreviewed PASS does not read as reviewed", () =>
    g(a, "#14014")?.latest_verdict?.verdict === "PASS" && g(a, "#14014")?.latest_verdict?.reviewed === false &&
    g(a, "#14014")?.latest_reviewed_verdict?.verdict === "PARTIAL"],
  ["no group key is derived from an email", () => !a.out.groups.some((x) => /jane/.test(x.key))],
  ["--top lists the ticket groups it cut", () => e.status === 0 && e.out.dropped_ticket_groups.length > 0],
  ["default pattern: `layout-1280` is not a ticket", () => d.out && !d.out.groups.some((x) => x.key === "#1280")],
  ["default pattern still finds `sc14001`", () => d.out && d.out.groups.some((x) => x.key === "#14001")],
  ["--since drops older dated evidence and reports", () =>
    g(c, "#14002")?.evidence_dirs === 0 && g(c, "#14002")?.verdicts.FAIL === undefined && g(c, "#14001")?.specs === 2],
];

let failed = 0;
for (const [name, check] of CASES) {
  let ok = false;
  try { ok = check(); } catch { ok = false; }
  if (!ok) { failed++; console.log(`FAIL  ${name}`); }
}
if (a.status !== 0) console.log(a.err);
console.log(`${CASES.length - failed}/${CASES.length} inventory cases passed`);
process.exit(failed ? 1 : 0);
