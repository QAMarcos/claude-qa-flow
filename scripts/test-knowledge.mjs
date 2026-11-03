#!/usr/bin/env node
// Regression cases for skills/manual-test/scripts/check-knowledge.mjs.
// Usage: node scripts/test-knowledge.mjs   (exit 1 on any failing case)

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CHECKER = join(ROOT, "skills", "manual-test", "scripts", "check-knowledge.mjs");
const TODAY = "2026-10-29";

const GOOD = `---
area: listings
pages: /listings, /listings/:id
---

## Onboarding dialog after every load
type: gotcha
summary: A "Welcome" dialog covers the page after every goto/reload; dismiss it with "Got it".
source: run 2026-10-23 listings-rfq
last_verified: 2026-10-23

## Filters control is a button
type: locator
page: /listings
element: control that opens the filter panel
locator: getByRole("button", { name: "More filters" })
source: run 2026-10-23 listings-rfq
last_verified: 2026-10-23

## Save search is not Save filters
type: intent
summary: "Save search" stores a search alert; it is not the filters save button.
ticket: DEMO-12
source: PO comment on DEMO-12
last_verified: 2026-10-20

## Fixture users
type: data
summary: qa-free@example.com is the free-tier fixture; qa+pro@company.test the paid one.
source: playwright/.auth setup
last_verified: 2026-10-29
`;

const entry = (fields) => `## Case\n${fields}\n`;
const base = "summary: s\nsource: run\nlast_verified: 2026-10-20\n";
const withSummary = (summary) => entry(`type: data\nsummary: ${summary}\nsource: r\nlast_verified: 2026-10-20`);

// [name, files {relpath: content}, expect {exit, errors?: [substr], warnings?: [substr], stale?: n, entries?: n, args?: [], raw?: bool}]
const CASES = [
  ["clean bank passes", { "listings.md": GOOD }, { exit: 0, errors: [], entries: 4, stale: 0 }],
  ["missing root is not an error", null, { exit: 0, errors: [] }],
  ["README holds no entries", { "README.md": "# Knowledge bank\n\nOne file per area. See the qa-flow docs." }, { exit: 0, errors: [], entries: 0 }],
  ["README is still scanned for secrets", { "README.md": "free text with password: hunter22" }, { exit: 1, errors: ["credential assignment"], entries: 0 }],
  ["missing required field", { "a.md": entry("type: gotcha\nsource: run\nlast_verified: 2026-10-20") }, { exit: 1, errors: ['missing "summary"'] }],
  ["unknown type", { "a.md": entry("type: rumour\n" + base) }, { exit: 1, errors: ['unknown type "rumour"'] }],
  ["locator needs page/element/locator", { "a.md": entry("type: locator\n" + base) }, { exit: 1, errors: ['missing "page"', 'missing "element"', 'missing "locator"'] }],
  ["intent needs ticket", { "a.md": entry("type: intent\n" + base) }, { exit: 1, errors: ['missing "ticket"'] }],
  ["known-bug needs ticket", { "a.md": entry("type: known-bug\n" + base) }, { exit: 1, errors: ['missing "ticket"'] }],
  ["bad date", { "a.md": entry("type: gotcha\nsummary: s\nsource: r\nlast_verified: 2026-02-30") }, { exit: 1, errors: ["not a valid YYYY-MM-DD"] }],
  ["future date", { "a.md": entry("type: gotcha\nsummary: s\nsource: r\nlast_verified: 2027-01-01") }, { exit: 1, errors: ["in the future"] }],
  ["trailing space after the date", { "a.md": entry("type: gotcha\nsummary: s\nsource: r\nlast_verified: 2026-10-20 ") }, { exit: 0, errors: [] }],
  ["stale entry is a warning", { "a.md": entry("type: gotcha\nsummary: s\nsource: r\nlast_verified: 2026-08-01") }, { exit: 0, warnings: ["stale: last verified 89 days ago"], stale: 1 }],
  ["--max-age must be a number", { "a.md": entry("type: gotcha\n" + base) }, { exit: 2, args: ["--max-age", "abc"], raw: true }],
  // query strings
  ["query string in URL", { "a.md": withSummary("open https://staging.app.example.com/plp?session=abc123 first") }, { exit: 1, errors: ["query string"] }],
  ["query string in a bare path", { "a.md": withSummary("seed with /listings?seed=edge-case") }, { exit: 1, errors: ["query string"] }],
  ["scheme-less URL with query", { "a.md": withSummary("open staging.app.com/plp?session=abc123") }, { exit: 1, errors: ["query string"] }],
  ["query string in a locator warns", { "a.md": entry("type: locator\npage: /listings\nelement: page 2 link\nlocator: page.locator('a[href=\"/listings?page=2\"]')\n" + base) }, { exit: 0, errors: [], warnings: ['query string in "locator"'] }],
  ["link to a PO comment in source warns", { "a.md": entry("type: intent\nsummary: s\nticket: DEMO-12\nsource: https://tracker.example.com/browse/DEMO-12?focusedCommentId=123\nlast_verified: 2026-10-20") }, { exit: 0, errors: [], warnings: ['query string in "source"'] }],
  // personal data
  ["real email (masked in the message)", { "a.md": withSummary("use jane.doe@gmail.com") }, { exit: 1, errors: ['email address "j***@gmail.com"'] }],
  ["URL-encoded email in a locator", { "a.md": entry("type: locator\npage: /people\nelement: row\nlocator: page.locator('a[href=\"/people?email=joao%40gmail.com\"]')\n" + base) }, { exit: 1, errors: ["email address"] }],
  ["email inside an H1", { "a.md": "# Login as root@corp.com\n" + entry("type: gotcha\n" + base) }, { exit: 1, errors: ["email address"] }],
  // secrets
  ["bearer token", { "a.md": withSummary("send Bearer abcdefghijklmnop1234") }, { exit: 1, errors: ["bearer token"] }],
  ["Authorization: Basic", { "a.md": withSummary("send Authorization: Basic dXNlcjpwYXNz") }, { exit: 1, errors: ["authorization header"] }],
  ["JWT", { "a.md": withSummary("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.abc") }, { exit: 1, errors: ["JWT"] }],
  ["password assignment", { "a.md": withSummary("login with password: Sup3rS3cret") }, { exit: 1, errors: ["credential assignment"] }],
  ["credential as the field key", { "a.md": entry("type: data\npassword: Sup3rS3cret!\n" + base) }, { exit: 1, errors: ["credential assignment"] }],
  ["prefixed key: access_token", { "a.md": withSummary("access_token: abcd1234efgh") }, { exit: 1, errors: ["credential assignment"] }],
  ["prefixed key: client_secret=", { "a.md": withSummary("use client_secret=abcd1234") }, { exit: 1, errors: ["credential assignment"] }],
  ["pt-BR: senha", { "a.md": withSummary("senha: minhasenha123") }, { exit: 1, errors: ["credential assignment"] }],
  ["cookie value", { "a.md": withSummary("set cookie: sid=abcdef123456") }, { exit: 1, errors: ["cookie"] }],
  ["GitHub token", { "a.md": withSummary("ghp_abcdefghijklmnopqrstuvwxyz0123") }, { exit: 1, errors: ["GitHub token"] }],
  ["Slack token", { "a.md": withSummary("xoxb-1234567890-abcdef") }, { exit: 1, errors: ["Slack token"] }],
  // third review — JSON / header shapes
  ["quoted JSON key: X-Api-Key", { "a.md": withSummary('send header {"X-Api-Key": "abcd1234efgh5678"}') }, { exit: 1, errors: ["credential assignment"] }],
  ["quoted JSON key: password", { "a.md": withSummary('body {"password": "letmein99"}') }, { exit: 1, errors: ["credential assignment"] }],
  ["spaced key: api key", { "a.md": withSummary("api key: 8fJk2LmN0pQr") }, { exit: 1, errors: ["credential assignment"] }],
  ["pasted storageState", { "a.md": withSummary('{"cookies":[{"name":"sid","value":"x"}]}') }, { exit: 1, errors: ["pasted storageState"] }],
  // fourth review — DevTools "Copy as fetch" shapes and other realistic slips
  ["JSON Authorization header", { "a.md": withSummary('headers: {"Authorization": "Basic cWE6c2VjcmV0MTIz"}') }, { exit: 1, errors: ["authorization header"] }],
  ["JSON lowercase authorization", { "a.md": withSummary('{"authorization":"Bearer abcdefgh12345678"}') }, { exit: 1, errors: ["authorization header"] }],
  ["JSON Cookie header", { "a.md": withSummary('{"Cookie": "connect.sid=s%3Aabc123def456"}') }, { exit: 1, errors: ["cookie"] }],
  ["basic auth in a URL", { "a.md": withSummary("open https://qa:Pr0pw1re!@staging.app.example.com/") }, { exit: 1, errors: ["credentials in a URL"] }],
  ["session header", { "a.md": withSummary("send x-session-id: 8f14e4a2b9c1d7e6") }, { exit: 1, errors: ["credential assignment"] }],
  ["exported session variable", { "a.md": withSummary("export QA_SESSION=8f14e4a2b9c1d7e6f0a1") }, { exit: 1, errors: ["credential assignment"] }],
  ["a single pasted cookie", { "a.md": withSummary('{"name":"next-auth.session-token","value":"abcdef1234567890"}') }, { exit: 1, errors: ["pasted cookie"] }],
  ["webhook secret", { "a.md": withSummary("webhook secret whsec_abcdefgh12345678") }, { exit: 1, errors: ["API key"] }],
  // final review — regressions from the exemptions, multi-line shapes
  ["TOTP seed in base32 is a secret", { "a.md": withSummary("totp_secret: JBSWY3DPEHPK3PXP") }, { exit: 1, errors: ["credential assignment"] }],
  ["upper-case key without underscore is a secret", { "a.md": withSummary("api_key: A1B2C3D4E5F6G7H8J9K0") }, { exit: 1, errors: ["credential assignment"] }],
  ["upper-case password is a secret", { "a.md": withSummary("password: SUMMER2026") }, { exit: 1, errors: ["credential assignment"] }],
  ["diceware passphrase is a secret", { "a.md": withSummary("password: correct-horse-battery-staple") }, { exit: 1, errors: ["credential assignment"] }],
  ["indented storageState is caught", { "a.md": entry("type: data\n" + base) + '\n```json\n{\n  "cookies": [\n    {\n      "name": "sid",\n      "value": "abc"\n    }\n  ]\n}\n```\n' }, { exit: 1, errors: ["pasted storageState"] }],
  ["indented cookie object is caught", { "a.md": entry("type: data\n" + base) + '\n{\n  "name": "next-auth.session-token",\n  "value": "abcdef1234567890"\n}\n' }, { exit: 1, errors: ["pasted cookie"] }],
  ["email with an encoded plus is masked", { "a.md": withSummary("login qa%2Bfree%40gmail.com") }, { exit: 1, errors: ['email address "q***%40gmail.com"'] }],
  ["secret in front matter", { "a.md": "---\narea: x\nnote: token=abcdef123456\n---\n" + entry("type: gotcha\n" + base) }, { exit: 1, errors: ["credential assignment"] }],
  ["secret inside a heading", { "a.md": "## Login with token=abcdef123456\ntype: gotcha\n" + base }, { exit: 1, errors: ["credential assignment"] }],
  ["secret in free text between entries", { "a.md": entry("type: gotcha\n" + base) + "\nsk_live_abcdefgh12345678\n" }, { exit: 1, errors: ["API key"] }],
  // structure
  ["duplicate heading warns", { "a.md": entry("type: gotcha\n" + base) + entry("type: gotcha\n" + base) }, { exit: 0, warnings: ["duplicate heading"] }],
  ["unknown field warns", { "a.md": entry("type: gotcha\nseverity: high\n" + base) }, { exit: 0, warnings: ['unknown field "severity"'] }],
  ["oversized file warns", { "a.md": Array.from({ length: 45 }, (_, i) => `## E${i}\ntype: gotcha\n${base}`).join("\n") }, { exit: 0, warnings: ["entries (budget 40)"] }],
  ["nested folders are read", { "web/checkout.md": entry("type: gotcha\n" + base) }, { exit: 0, entries: 1 }],
  ["CRLF files parse", { "a.md": GOOD.replace(/\n/g, "\r\n") }, { exit: 0, errors: [], entries: 4 }],
  // no false positives on ordinary content
  ["locator text is not a false secret", { "a.md": entry('type: locator\npage: /login\nelement: password field\nlocator: getByLabel("Password")\n' + base) }, { exit: 0, errors: [] }],
  ["prose about tokens is not a secret", { "a.md": withSummary("the token field stays empty until the user verifies the email") }, { exit: 0, errors: [] }],
  ["quoted UI copy about a password", { "a.md": entry('type: intent\nsummary: "Invalid password: please try again" is the intended message\nticket: DEMO-2\nsource: PO\nlast_verified: 2026-10-20') }, { exit: 0, errors: [] }],
  ["pt-BR locator with Senha:", { "a.md": entry('type: locator\npage: /cadastro\nelement: password hint\nlocator: getByText("Senha: mínimo 8 caracteres")\n' + base) }, { exit: 0, errors: [] }],
  ["env reference is not a secret", { "a.md": withSummary("log in with --password=$QA_PASSWORD from .env") }, { exit: 0, errors: [] }],
  ["csrf_token: refreshed", { "a.md": withSummary("csrf_token: refreshed on every page load") }, { exit: 0, errors: [] }],
  ["hyphenated: Reset token: single-use", { "a.md": withSummary("Reset token: single-use, expires in 15 minutes") }, { exit: 0, errors: [] }],
  ["hyphenated: API key: read-only", { "a.md": withSummary("The staging API key: read-only, scoped to listings") }, { exit: 0, errors: [] }],
  ["pt-BR hyphenated: senha: case-sensitive", { "a.md": withSummary("Campo senha: case-sensitive; mínimo 8") }, { exit: 0, errors: [] }],
  ["password=auto-generated", { "a.md": withSummary("new users get password=auto-generated by the seed") }, { exit: 0, errors: [] }],
  ["env-var name without $", { "a.md": withSummary("password: QA_FREE_PASSWORD from .env.local") }, { exit: 0, errors: [] }],
  ["session prose", { "a.md": withSummary("session: expires after 30 minutes idle") }, { exit: 0, errors: [] }],
];

let failed = 0;
for (const [name, files, expect] of CASES) {
  const dir = mkdtempSync(join(tmpdir(), "qa-kb-"));
  const root = join(dir, "knowledge");
  if (files) {
    for (const [rel, content] of Object.entries(files)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), content);
    }
  }
  const run = spawnSync(process.execPath, [CHECKER, root, "--json", "--today", TODAY, ...(expect.args ?? [])], { encoding: "utf8" });
  rmSync(dir, { recursive: true, force: true });
  const problems = [];
  let out;
  if (!expect.raw) {
    try { out = JSON.parse(run.stdout); } catch { problems.push(`unparseable output: ${run.stdout}${run.stderr}`); }
  }
  if (run.status !== expect.exit) problems.push(`exit ${run.status}, expected ${expect.exit}`);
  if (out) {
    const msgs = (list) => list.map((e) => e.msg).join(" | ");
    if (expect.errors?.length === 0 && out.errors.length) problems.push(`unexpected errors: ${msgs(out.errors)}`);
    for (const s of expect.errors ?? []) if (!msgs(out.errors).includes(s)) problems.push(`missing error "${s}" in: ${msgs(out.errors)}`);
    for (const s of expect.warnings ?? []) if (!msgs(out.warnings).includes(s)) problems.push(`missing warning "${s}" in: ${msgs(out.warnings)}`);
    if (expect.stale !== undefined && out.stale.length !== expect.stale) problems.push(`stale ${out.stale.length}, expected ${expect.stale}`);
    if (expect.entries !== undefined && out.entries !== expect.entries) problems.push(`entries ${out.entries}, expected ${expect.entries}`);
  }
  if (problems.length) {
    failed++;
    console.log(`FAIL  ${name}\n      ${problems.join("\n      ")}`);
  }
}
console.log(`${CASES.length - failed}/${CASES.length} knowledge-checker cases passed`);
process.exit(failed ? 1 : 0);
