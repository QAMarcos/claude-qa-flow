#!/usr/bin/env node
// Validates a qa-flow knowledge bank (see ../references/knowledge-bank.md).
//
// Usage: node check-knowledge.mjs [knowledge root] [--max-age <days>] [--json] [--today YYYY-MM-DD]
//   knowledge root   default .qa-flow/knowledge
//   --max-age        entries older than this are reported as stale (default 30)
//   --json           machine-readable summary on stdout
//   --today          pin "today" (tests)
//
// Exit 1 when any error is found (missing fields, secrets, emails, query strings, bad dates),
// 0 otherwise — stale entries, size budget and query strings in `locator`/`ticket`/`source` are
// warnings. Exit 2 on bad arguments. A missing root is not an error: the knowledge bank is optional.
// Every non-empty line of every Markdown file (README included, headings included) is scanned for
// secrets, emails and query strings. NOT detected (on the person approving the entry): phone
// numbers, names, addresses, identity-document numbers; secrets written as prose ("the password is
// hunter"); short (< 8) or letters-only values; values typed in a `.fill("…")`; headers or variables
// whose name is not credential-like. Emails are masked in the output. No dependencies.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const JSON_OUT = args.includes("--json") && args.splice(args.indexOf("--json"), 1);
const MAX_AGE = Number(flag("--max-age") ?? 30);
const TODAY = flag("--today") ?? new Date().toISOString().slice(0, 10);
const ROOT = args[0] ?? join(".qa-flow", "knowledge");
if (!Number.isFinite(MAX_AGE) || MAX_AGE < 0) {
  console.error("--max-age must be a non-negative number of days");
  process.exit(2);
}

const TYPES = new Set(["gotcha", "locator", "intent", "known-bug", "data"]);
const REQUIRED = ["type", "source", "last_verified"];
// A locator entry's `element` says what it is for, so it needs no summary.
const REQUIRED_BY_TYPE = {
  gotcha: ["summary"], data: ["summary"], locator: ["page", "element", "locator"],
  intent: ["summary", "ticket"], "known-bug": ["summary", "ticket"],
};
const KNOWN_KEYS = new Set([...REQUIRED, "summary", "page", "element", "locator", "ticket", "note"]);
// In these fields a query string is legitimate often enough (a locator on `a[href="/x?page=2"]`, a
// link to a PO comment) to be a warning instead of an error. Secrets in them are still errors.
const QUERY_OK_FIELDS = new Set(["locator", "ticket", "source"]);
const MAX_ENTRIES = 40;
const MAX_BYTES = 12 * 1024;

const SECRETS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY/, "private key"],
  [/\bbearer\s+[A-Za-z0-9._~+/=-]{12,}/i, "bearer token"],
  // Header shapes as typed and as DevTools' "Copy as fetch" writes them (`"Authorization": "Basic …"`).
  [/\bauthorization["']?\s*[:=]\s*["']?(?:basic|bearer|token)\s+\S{8,}/i, "authorization header"],
  [/\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@"']+:[^\s/@"']+@/i, "credentials in a URL"],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/, "JWT"],
  [/\b(?:(?:sk|pk|rk)_(?:live|test)|whsec)_[A-Za-z0-9]{8,}/, "API key"],
  [/\bgh[pousr]_[A-Za-z0-9]{20,}/, "GitHub token"],
  [/\bglpat-[A-Za-z0-9_-]{16,}/, "GitLab token"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "Slack token"],
  [/\bAIza[0-9A-Za-z_-]{30,}/, "Google API key"],
  [/\bAKIA[0-9A-Z]{16}\b/, "AWS access key"],
  [/(?:^|[^A-Za-z0-9])(?:set-)?cookie["']?\s*[:=]\s*["']?[^\s;"']+=[^\s;"']{6,}/i, "cookie"],
  [/["']cookies["']\s*:\s*\[\s*\{/i, "pasted storageState"],
  [/"name"\s*:\s*"[^"]*(?:session|token|sid|auth)[^"]*"\s*,\s*"value"\s*:\s*"[^"]{8,}"/i, "pasted cookie"],
];
// `access_token: x`, `client_secret=x`, `senha: x`, `"X-Api-Key": "x"`, `api key: x`,
// `x-session-id: x`, `export QA_SESSION=x` — the key may carry a prefix and be quoted. Judged by the
// VALUE too (`looksSecret`), so UI copy (`"Invalid password: please try again"`), hyphenated words
// (`single-use`, `read-only`) and env references (`$QA_PASSWORD`, `QA_FREE_PASSWORD`) pass.
const CREDENTIAL = /(?:^|[^A-Za-z0-9])[\w-]*(?:password|passwd|pwd|senha|secret|token|api[_\s-]?key|session)[\w-]*["']?\s*[:=]\s*["']?([^\s"',;]+)/gi;
const looksSecret = (v) =>
  !/^(\$|process\.env|%[A-Z_]+%|<)/i.test(v) &&
  !/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(v) &&   // an env-var NAME (has an underscore), not its value
  !(v.length < 20 && /^\p{L}+(?:-\p{L}+)+[.,;:!?]?$/u.test(v)) && // single-use, case-sensitive — not a passphrase
  ((v.length >= 8 && /[\d!@#$%^&*_+=\/~-]/.test(v) && /[A-Za-z]/.test(v)) || v.length >= 20);
// Shapes that span lines: a pasted, indented storageState or cookie object.
const MULTILINE_SECRETS = [
  [/["']cookies["']\s*:\s*\[\s*\{/i, "pasted storageState"],
  [/"name"\s*:\s*"[^"]*(?:session|token|sid|auth)[^"]*"\s*,\s*"value"\s*:\s*"[^"]{8,}"/i, "pasted cookie"],
  [/["']origins["']\s*:\s*\[\s*\{\s*["']origin["']/i, "pasted storageState"],
];
const EMAIL = /[A-Za-z0-9._%+-]+(?:@|%40)([A-Za-z0-9-]+\.)+[A-Za-z]{2,}/gi;
// Mask what the checker prints — the point is not to copy personal data anywhere.
const mask = (email) => email.replace(/^(.).*?(@|%40)/i, "$1***$2");
const ALLOWED_EMAIL_DOMAIN = /@(?:[\w-]+\.)*(?:example\.(?:com|org|net)|[\w-]+\.(?:test|invalid|example|localhost))$/i;
// A query string after: a URL with a scheme, a bare host (`app.example.com/x?k=`), or a path (`/x?k=`).
const QUERY_STRING = /(?:[a-z][a-z0-9+.-]*:\/\/[^\s"'`)]*|(?:^|[\s"'`(=])(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/[^\s"'`)]*|(?:^|[\s"'`(=])\/[\w./:%-]*)\?[\w.%[\]-]+=/i;

const errors = [];
const warnings = [];
const stale = [];
let entryCount = 0;
let fileCount = 0;

if (!existsSync(ROOT)) {
  return_({ note: `no knowledge bank at ${ROOT}` });
}

for (const file of listMarkdown(ROOT)) {
  fileCount++;
  checkFile(file);
}
return_({});

function return_(extra) {
  const summary = { root: ROOT, today: TODAY, max_age: MAX_AGE, files: fileCount, entries: entryCount, errors, warnings, stale, ...extra };
  if (JSON_OUT) {
    process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
  } else {
    if (extra.note) console.log(extra.note);
    for (const e of errors) console.log(`error   ${e.file}:${e.line} [${e.entry}] ${e.msg}`);
    for (const w of warnings) console.log(`warning ${w.file}:${w.line} [${w.entry}] ${w.msg}`);
    console.log(`${fileCount} file(s), ${entryCount} entr${entryCount === 1 ? "y" : "ies"}, ` +
      `${errors.length} error(s), ${warnings.length} warning(s), ${stale.length} stale`);
  }
  process.exit(errors.length ? 1 : 0);
}

function listMarkdown(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...listMarkdown(path));
    else if (name.endsWith(".md")) out.push(path);
  }
  return out;
}

function checkFile(path) {
  const file = relative(ROOT, path) || path;
  const raw = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  const lines = raw.split("\n");

  // Every line is scanned for what must never be stored, whatever the file's structure — and the
  // whole file once more for shapes that span lines (an indented storageState, as Playwright writes it).
  const scanAll = (entryAt) => {
    lines.forEach((line, k) => line.trim() && scanLine(file, k + 1, entryAt(k), line));
    for (const [re, label] of MULTILINE_SECRETS) {
      const m = raw.match(re);
      if (m) errors.push({ file, line: raw.slice(0, m.index).split("\n").length, entry: entryAt(raw.slice(0, m.index).split("\n").length - 1), msg: `looks like a ${label} — never store credentials` });
    }
  };

  if (/^readme\.md$/i.test(path.split(/[\\/]/).pop())) {
    scanAll(() => "README");
    return; // a README explains the bank; it holds no entries
  }
  if (Buffer.byteLength(raw) > MAX_BYTES) {
    warnings.push({ file, line: 1, entry: "-", msg: `file is ${Math.round(Buffer.byteLength(raw) / 1024)} KB (budget ${MAX_BYTES / 1024} KB) — prune` });
  }

  let i = 0;
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1);
    if (end === -1) errors.push({ file, line: 1, entry: "-", msg: "front matter is not closed with ---" });
    else i = end + 1;
  }

  const titleAt = new Map();
  const seen = new Map();
  let entry = null;
  const flush = () => {
    if (!entry) return;
    entryCount++;
    checkEntry(file, entry);
    entry = null;
  };
  for (; i < lines.length; i++) {
    const line = lines[i];
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      flush();
      const title = heading[1];
      if (seen.has(title)) {
        warnings.push({ file, line: i + 1, entry: title, msg: `duplicate heading (also at line ${seen.get(title)})` });
      }
      seen.set(title, i + 1);
      entry = { title, line: i + 1, fields: {} };
      titleAt.set(i, title);
      continue;
    }
    if (entry) titleAt.set(i, entry.title);
    if (!entry || !line.trim() || /^#\s/.test(line)) continue;
    const kv = line.match(/^([a-z_-]+):\s*(.*)$/);
    if (!kv) {
      warnings.push({ file, line: i + 1, entry: entry.title, msg: "free text inside an entry — put it in `summary` or `note`" });
      continue;
    }
    const [, key, rawValue] = kv;
    const value = rawValue.trim();
    if (!KNOWN_KEYS.has(key)) warnings.push({ file, line: i + 1, entry: entry.title, msg: `unknown field "${key}"` });
    if (key in entry.fields) warnings.push({ file, line: i + 1, entry: entry.title, msg: `field "${key}" repeated — last one wins` });
    entry.fields[key] = { value, line: i + 1 };
  }
  flush();
  if (seen.size > MAX_ENTRIES) {
    warnings.push({ file, line: 1, entry: "-", msg: `${seen.size} entries (budget ${MAX_ENTRIES}) — prune` });
  }
  scanAll((k) => titleAt.get(k) ?? (k === 0 || lines[0] === "---" ? "front matter" : "-"));
}

function checkEntry(file, { title, line, fields }) {
  const err = (msg, at = line) => errors.push({ file, line: at, entry: title, msg });
  const type = fields.type?.value;
  if (type && !TYPES.has(type)) err(`unknown type "${type}" (expected ${[...TYPES].join(", ")})`, fields.type.line);
  const required = [...REQUIRED, ...(REQUIRED_BY_TYPE[type] ?? [])];
  for (const key of required) {
    if (!fields[key]?.value) err(`missing "${key}"`);
  }
  const lv = fields.last_verified;
  if (lv?.value) {
    const age = daysBetween(lv.value, TODAY);
    if (age === null) err(`last_verified "${lv.value}" is not a valid YYYY-MM-DD date`, lv.line);
    else if (age < 0) err(`last_verified ${lv.value} is in the future`, lv.line);
    else if (age > MAX_AGE) {
      warnings.push({ file, line: lv.line, entry: title, msg: `stale: last verified ${age} days ago` });
      stale.push({ file, entry: title, type: type ?? null, last_verified: lv.value, age_days: age });
    }
  }
}

function scanLine(file, line, entry, text) {
  for (const [re, label] of SECRETS) {
    if (re.test(text)) errors.push({ file, line, entry, msg: `looks like a ${label} — never store credentials` });
  }
  if ([...text.matchAll(CREDENTIAL)].some((m) => looksSecret(m[1]))) {
    errors.push({ file, line, entry, msg: "looks like a credential assignment — never store credentials" });
  }
  for (const m of text.matchAll(EMAIL)) {
    if (!ALLOWED_EMAIL_DOMAIN.test(m[0].replace(/%40/i, "@"))) {
      errors.push({ file, line, entry, msg: `email address "${mask(m[0])}" — describe the fixture's role instead` });
    }
  }
  if (QUERY_STRING.test(text)) {
    const key = text.match(/^([a-z_-]+):/)?.[1];
    if (QUERY_OK_FIELDS.has(key)) {
      warnings.push({ file, line, entry, msg: `query string in "${key}" — make sure it carries no session id, token or personal data` });
    } else {
      errors.push({ file, line, entry, msg: "URL with a query string — write the path and describe the parameters" });
    }
  }
}

function daysBetween(from, to) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const a = from.match(re);
  const b = to.match(re);
  if (!a || !b) return null;
  const da = Date.UTC(+a[1], +a[2] - 1, +a[3]);
  const db = Date.UTC(+b[1], +b[2] - 1, +b[3]);
  if (new Date(da).getUTCDate() !== +a[3]) return null; // 2026-02-30
  return Math.round((db - da) / 86_400_000);
}
