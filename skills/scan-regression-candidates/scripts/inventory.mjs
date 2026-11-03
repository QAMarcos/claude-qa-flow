#!/usr/bin/env node
// Builds a compact, privacy-safe inventory of a QA scratch root (default `_local/`) for the
// scan-regression-candidates skill: groups the throwaway scripts, evidence folders, logs and
// reports by ticket (or by name stem), with dates, run counts, verdicts, test titles, step names,
// visited paths and red flags — so the model reads a few KB of JSON instead of thousands of files.
//
// Usage: node inventory.mjs [scratch root] [--ticket <regex>] [--id-range <min>-<max>]
//                           [--since YYYY-MM-DD] [--out <file>] [--top <n>]
//   --ticket    ticket-id regex (default: (?:sc|[A-Z]{2,10})-?\d{3,6}, case-insensitive). It is matched
//               against EVERY path component (folders included), nearest first.
//   --id-range  keep only ticket numbers in this range — use it when the pattern's prefix is optional
//               and logs/evidence carry other numeric ids (record ids, timestamps, ports).
//   --since     ignore files whose date is earlier
//   --out       write the JSON there instead of stdout
//   --top       keep only the N strongest groups in `groups` (default 80); totals always cover all
//
// Dates: a date in the path (2026-10-23 or 20261023) wins over the file's mtime — bulk copies and
// touches make mtimes unreliable. Each group records how many of its dates came from names.
//
// Never reads or reports: folders named secrets / state / .auth / worktrees / node_modules /
// test-results / playwright-report / allure-*, files whose name suggests credentials or browser state
// (env, token, secret, cookie, storage, auth, credential, session, password, key), or binary files.
// From scripts it extracts only titles, step names, URL paths (origin and query string removed, ids
// collapsed) and counts; from reports, only verdict words. No dependencies.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args.splice(i, 2)[1];
};
// `(?!-\d{2}-\d{2})` keeps dates out: `rfq-2026-10-23` is a folder name, not ticket RFQ-2026.
// The default is case-sensitive (upper-case project keys, or `sc`/`SC`), so `layout-1280`, `run-001`
// and `node-18` are not tickets; a custom --ticket pattern is matched case-insensitively.
const CUSTOM_TICKET = opt("--ticket", null);
const TICKET = new RegExp(`(?<![A-Za-z0-9])(${CUSTOM_TICKET ?? String.raw`(?:[Ss][Cc]|[A-Z]{2,10})-?\d{3,6}`})(?![0-9])`, CUSTOM_TICKET ? "gi" : "g");
// …but only a YEAR followed by -MM-DD is a date; `ABC-1042-02-03-run` is still ticket 1042.
const isDate = (num, after) => /^20\d{2}$/.test(num) && /^-\d{2}-\d{2}/.test(after);
const RANGE = (opt("--id-range", "") || "").split("-").map(Number);
const SINCE = opt("--since", null);
const OUT = opt("--out", null);
const TOP = Number(opt("--top", 80));
const ROOT = args[0] ?? "_local";

const SKIP_DIRS = /^(secrets?|state|\.auth|auth|worktrees?|node_modules|test-results|playwright-report.*|allure-(results|report).*|\.git|\.cache)$/i;
const SENSITIVE_FILE = /(^\.env|env\.|token|secret|cookie|storage|auth|credential|session|passw|apikey|api-key|\.pem$|\.key$)/i;
const SCRIPT_EXT = new Set([".ts", ".js", ".mjs", ".cjs", ".py", ".ps1", ".sh"]);
// Files that tend to carry a run's verdict, as people actually name them.
const REPORT_NAME = /(report|summary|review|verdict|result|comment|ledger|retest|pass-fail|handoff).*\.(json|jsonl|md|txt)$/i;
// Verdict phrases as people and manual-test write them: "QA retest — … — PASS", "Retest: FAIL.",
// `"verdict": "PASS"`, and manual-test's own header "Manual test — <id> | <env> | PASS".
const VERDICT_WORD = String.raw`(PASS|FAIL|PARTIAL|BLOCKED|INCONCLUSIVE|PO-DECISION)`;
// ("status" is not a trigger: tool output like `Status 'failed' provided for 1 events` is not a verdict.)
const VERDICT = new RegExp(String.raw`\b(?:verdict|result|retest|re-test|qa(?:\s+\w+)?)\b[^\n]{0,80}?\b${VERDICT_WORD}(?:ED)?\b|"verdict"\s*:\s*"${VERDICT_WORD}"|^Manual test\b[^\n]*\|\s*${VERDICT_WORD}\s*$`, "gim");
// JSON files carry structured results (often one entry per CHECK): only a top-level-looking
// "verdict" key counts there, never per-check "status"/"result" words.
const JSON_VERDICT = new RegExp(String.raw`"verdict"\s*:\s*"${VERDICT_WORD}"`, "gi");
// On a same-day tie, the more cautious verdict wins.
const SEVERITY = { FAIL: 5, PARTIAL: 4, BLOCKED: 3, INCONCLUSIVE: 3, "PO-DECISION": 2, PASS: 1 };
const PROBE_NAME = /(recon|probe|diag|debug|dump|crop|annotate|scratch|tmp|test-?run|seed|inspect)/i;
const NAME_DATE = /(?<!\d)(20\d{2})-?(0[1-9]|1[0-2])-?(0[1-9]|[12]\d|3[01])(?!\d)/;
const MAX_READ = 400 * 1024;

if (!existsSync(ROOT)) {
  console.error(`no scratch root at ${ROOT}`);
  process.exit(1);
}

const groups = new Map();
const totals = { files: 0, skipped_sensitive: 0, skipped_dirs: [], skipped_before_since: 0, scripts: 0, specs: 0, evidence_dirs: 0, logs: 0, reports: 0, verdicts: 0 };

walk(ROOT, 0);

function walk(dir, depth) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const path = join(dir, e.name);
    const rel = relative(ROOT, path).split(sep).join("/");
    if (e.isDirectory()) {
      if (SKIP_DIRS.test(e.name)) { totals.skipped_dirs.push(rel); continue; }
      if (depth === 1 && /^evidence$/i.test(basename(dir))) addEvidenceDir(path, rel);
      walk(path, depth + 1);
      continue;
    }
    if (!e.isFile()) continue;
    totals.files++;
    if (SENSITIVE_FILE.test(e.name)) { totals.skipped_sensitive++; continue; }
    const date = dateOf(path, rel);
    if (SINCE && date.value < SINCE) { totals.skipped_before_since++; continue; }
    const top = rel.split("/")[0];
    const ext = extname(e.name).toLowerCase();
    if (top === "scripts" && SCRIPT_EXT.has(ext)) addScript(path, rel, e.name, date);
    else if (top === "logs" && /\.(log|txt|json|jsonl)$/i.test(e.name)) addLog(rel, e.name, date);
    // Run logs are output, not reports — even when their name says "retest" or "result".
    // Everything in a `reports/` folder is a report (manual-test saves its reviewed results there).
    if (top !== "logs" && (REPORT_NAME.test(e.name) || /(^|\/)reports\//i.test(rel))) addReport(path, rel, e.name, date);
  }
}

function dateOf(path, rel) {
  const m = rel.match(NAME_DATE);
  if (m) return { value: `${m[1]}-${m[2]}-${m[3]}`, fromName: true };
  return { value: statSync(path).mtime.toISOString().slice(0, 10), fromName: false };
}

// The ticket comes from the nearest path component that carries one (file name first, then its
// folders), so `scripts/ABC-1042-retest/recon.spec.ts` belongs to #1042.
function ticketOf(rel) {
  const parts = rel.split("/").slice(1).reverse();
  for (const part of parts) {
    for (const t of part.matchAll(TICKET)) {
      const digits = t[1].replace(/\D/g, "");
      if (isDate(digits, part.slice(t.index + t[0].length))) continue;
      const n = Number(digits);
      if (RANGE.length === 2 && RANGE.every(Number.isFinite) && (n < RANGE[0] || n > RANGE[1])) continue;
      return { key: `#${n}`, ticket: t[1] };
    }
  }
  return null;
}

function groupFor(rel) {
  const t = ticketOf(rel);
  if (t) return t;
  // No ticket id: group by the family of the name — its first meaningful token without a trailing
  // number (`_fcb2-03-…`, `_fcb5-…` → "fcb"), or the sub-folder it sits in under scripts/ / evidence/.
  const parts = rel.split("/");
  const name = redact(parts.length > 2 ? parts[1] : parts.pop(), { slugs: true });
  const stem = name.replace(/\.(spec|config|test)?\.?[a-z0-9]+$/i, "").replace(/^[_.-]+/, "")
    .replace(/^manual[-_]/i, "").split(/[-_.]+/).filter((t) => t && !/^\d+$/.test(t) && !/^(p|pass|r|run|v)\d*$/i.test(t));
  return { key: (stem[0] ?? "misc").replace(/\d+$/, "").toLowerCase() || "misc", ticket: null };
}

function group(rel) {
  const { key, ticket } = groupFor(rel);
  if (!groups.has(key)) {
    groups.set(key, {
      key, tickets: new Set(), specs: [], other_scripts: 0, probe_scripts: 0, evidence_dirs: [], evidence_files: 0,
      logs: 0, reports: [], days: new Set(), named_dates: 0, dated: 0, first_seen: null, last_seen: null,
      titles: new Set(), steps: new Set(), paths: new Set(), expects: 0,
      flags: { hard_waits: 0, force_clicks: 0, evaluate_clicks: 0 }, verdicts: {}, verdict_files: new Set(),
    });
  }
  const g = groups.get(key);
  if (ticket) g.tickets.add(ticket.toLowerCase());
  return g;
}

function stamp(g, date) {
  g.days.add(date.value);
  g.dated++;
  if (date.fromName) g.named_dates++;
  if (!g.first_seen || date.value < g.first_seen) g.first_seen = date.value;
  if (!g.last_seen || date.value > g.last_seen) g.last_seen = date.value;
}

function readText(path) {
  try {
    if (statSync(path).size > MAX_READ) return "";
    const s = readFileSync(path, "utf8");
    return s.includes("\u0000") ? "" : s;
  } catch { return ""; }
}

function addScript(path, rel, name, date) {
  totals.scripts++;
  const g = group(rel);
  stamp(g, date);
  const isSpec = /\.spec\.[cm]?[jt]s$/i.test(name);
  if (PROBE_NAME.test(name)) g.probe_scripts++;
  if (!isSpec) { g.other_scripts++; return; }
  totals.specs++;
  g.specs.push(rel);
  const src = readText(path);
  for (const m of src.matchAll(/\btest(?:\.describe)?(?:\.(?:only|skip|fixme|serial))?\(\s*(["'`])((?:(?!\1).){3,140})\1/g)) g.titles.add(redact(m[2]));
  for (const m of src.matchAll(/\btest\.step\(\s*(["'`])((?:(?!\1).){3,140})\1/g)) g.steps.add(redact(m[2]));
  for (const m of src.matchAll(/\bgoto\(\s*(["'`])((?:(?!\1).)+)\1/g)) {
    const p = cleanPath(m[2]);
    if (p) g.paths.add(p);
  }
  g.expects += (src.match(/\bexpect(\.soft)?\(/g) ?? []).length;
  g.flags.hard_waits += (src.match(/waitForTimeout\(/g) ?? []).length;
  g.flags.force_clicks += (src.match(/force:\s*true/g) ?? []).length;
  g.flags.evaluate_clicks += (src.match(/\.click\(\)\s*\)|dispatchEvent\(\s*["']click/g) ?? []).length;
}

// Titles and step names are free text a person typed: redact what could identify someone or carry a
// secret before it leaves this script.
function redact(text, { slugs = false } = {}) {
  const longToken = slugs ? /\b[A-Za-z0-9_]{24,}\b/g : /\b[A-Za-z0-9_-]{24,}\b/g;
  return text
    .replace(/[A-Za-z0-9._%+-]+(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<email>")
    .replace(/\beyJ[\w-]{6,}(?:\.[\w-]+){1,2}/g, "<token>")
    .replace(/\b(?:AKIA[0-9A-Z]{16}|(?:sk|pk|rk)_(?:live|test)_\w{8,}|gh[pousr]_\w{20,})\b/g, "<token>")
    .replace(/\b(?:password|senha|pwd)\b\s*[:=]?\s*\S{4,}|\bpass\s+\S{4,}/gi, "<secret>")
    .replace(longToken, "<token>")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "<doc>")
    .replace(/\+?\(?\d{2,3}\)?[\s.-]?\d{3,5}[\s.-]\d{4}\b/g, "<phone>")
    .replace(/\d{6,}/g, "<n>");
}

// File paths in the output: each segment redacted like free text (a folder named after a person's
// email, a token in a file name).
// Hyphenated slugs (`abc-1043-checkout-retest-2026-10-23`) stay readable — promote needs them to
// find the run; only a long unbroken run of characters counts as a token in a path.
function redactPath(rel) {
  return rel.split("/").map((s) => redact(s, { slugs: true })).join("/");
}

// Origin and query string dropped; segments that look like ids, tokens or addresses collapsed to :id.
function cleanPath(url) {
  let p = url.replace(/\$\{[^}]*\}/g, ":var");
  p = p.replace(/^[a-z]+:\/\/[^/]+/i, "").split(/[?#]/)[0];
  if (!p.startsWith("/")) return null;
  const idLike = (s) => /^\d+$|^[0-9a-f-]{12,}$|^[A-Za-z0-9_-]{20,}$|@|%40/i.test(s) ||
    (s.length >= 16 && /[.]/.test(s)) || (s.length >= 12 && /\d/.test(s) && /[A-Za-z]/.test(s));
  return p.split("/").map((s) => (idLike(s) ? ":id" : s)).join("/") || "/";
}

function addEvidenceDir(path, rel) {
  const date = dateOf(path, rel);
  if (SINCE && date.value < SINCE) { totals.skipped_before_since++; return; }
  totals.evidence_dirs++;
  const g = group(rel);
  stamp(g, date);
  g.evidence_dirs.push(rel);
  try { g.evidence_files += countFiles(path); } catch { /* ignore */ }
}

function countFiles(dir) {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) n += countFiles(join(dir, e.name)); }
    else n++;
  }
  return n;
}

function addLog(rel, name, date) {
  totals.logs++;
  const g = group(rel);
  stamp(g, date);
  g.logs++;
}

function addReport(path, rel, name, date) {
  totals.reports++;
  const g = group(rel);
  stamp(g, date);
  g.reports.push(rel);
  // One vote per file and verdict (five drafts of the same comment are one verdict, not five), and
  // the file's LAST verdict, dated, so "a later PASS after the FAIL" can be read off the group.
  const text = readText(path);
  // A saved manual-test result carries the reviewer's verdict under its own key — that one decides.
  const reviewed = text.match(new RegExp(String.raw`"reviewer_verdict"\s*:\s*"${VERDICT_WORD}"`, "i"));
  const found = reviewed ? [reviewed[1].toUpperCase()]
    : /\.jsonl?$/i.test(name) ? [...text.matchAll(JSON_VERDICT)].map((m) => m[1].toUpperCase())
      : [...text.matchAll(VERDICT)].map((m) => (m[1] ?? m[2] ?? m[3]).toUpperCase());
  if (reviewed) g.reviewed = true;
  for (const v of new Set(found)) {
    g.verdicts[v] = (g.verdicts[v] ?? 0) + 1;
    totals.verdicts++;
  }
  if (found.length) {
    g.verdict_files.add(rel);
    // `reviewed` on the verdict itself: a later unreviewed note must not read as a reviewed PASS.
    const last = { verdict: found[found.length - 1], date: date.value, file: rel, reviewed: Boolean(reviewed) };
    if (reviewed && (!g.latestReviewed || last.date >= g.latestReviewed.date)) g.latestReviewed = last;
    if (!g.latest || last.date > g.latest.date ||
        (last.date === g.latest.date && SEVERITY[last.verdict] > SEVERITY[g.latest.verdict])) g.latest = last;
  }
}

const list = [...groups.values()].map((g) => ({
  key: g.key,
  tickets: [...g.tickets],
  first_seen: g.first_seen,
  last_seen: g.last_seen,
  active_days: g.days.size,
  dates_from_names: `${g.named_dates}/${g.dated}`,
  specs: g.specs.length,
  probe_scripts: g.probe_scripts,
  other_scripts: g.other_scripts,
  evidence_dirs: g.evidence_dirs.length,
  evidence_files: g.evidence_files,
  logs: g.logs,
  reports: g.reports.slice(0, 6).map(redactPath),
  verdicts: g.verdicts,
  reviewed: Boolean(g.reviewed),
  latest_verdict: g.latest ? { ...g.latest, file: redactPath(g.latest.file) } : null,
  latest_reviewed_verdict: g.latestReviewed ? { ...g.latestReviewed, file: redactPath(g.latestReviewed.file) } : null,
  verdict_files: [...g.verdict_files].slice(0, 6).map(redactPath),
  expects: g.expects,
  flags: g.flags,
  paths: [...g.paths].slice(0, 12),
  titles: [...g.titles].slice(0, 12),
  steps: [...g.steps].slice(0, 15),
  sample_specs: g.specs.sort().slice(0, 6).map(redactPath),
  only_probes: g.probe_scripts > 0 && g.probe_scripts >= g.specs.length + g.other_scripts,
}));
// Groups that look like tested scenarios first (a ticket, real specs, a verdict), then by recurrence.
const weight = (g) => (g.tickets.length ? 2 : 0) + (g.specs > g.probe_scripts ? 1 : 0) + (Object.keys(g.verdicts).length ? 1 : 0);
list.sort((a, b) => weight(b) - weight(a) || b.active_days - a.active_days ||
  (b.specs + b.evidence_dirs) - (a.specs + a.evidence_dirs) || String(b.last_seen).localeCompare(String(a.last_seen)));

const result = {
  root: ROOT,
  generated: new Date().toISOString(),
  ticket_pattern: TICKET.source,
  id_range: RANGE.length === 2 ? RANGE : null,
  since: SINCE,
  totals: { ...totals, groups: list.length, ticket_groups: list.filter((g) => g.tickets.length).length, skipped_dirs: totals.skipped_dirs.slice(0, 20) },
  groups: list.slice(0, TOP),
  // Never drop a ticket silently: anything --top cut is listed, so the scan can raise --top.
  dropped_ticket_groups: list.slice(TOP).filter((g) => g.tickets.length).map((g) => g.key),
};
const json = JSON.stringify(result, null, 1);
if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  console.log(`inventory: ${list.length} groups (${result.totals.ticket_groups} with a ticket, ${Math.min(TOP, list.length)} kept), ` +
    `${totals.specs} specs, ${totals.evidence_dirs} evidence dirs, ${totals.logs} logs, ${totals.verdicts} verdicts → ${OUT}`);
} else {
  process.stdout.write(json + "\n");
}
