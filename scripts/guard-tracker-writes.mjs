#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash / PowerShell). Backs up the role boundaries of the
// manual-test subagents, so common violations are blocked even if the model ignores its
// instructions:
//
//   qa-test-executor      may run anything EXCEPT mutating HTTP calls to non-local hosts, tracker
//                         CLI writes (gh/glab), and git commit/push.
//   qa-evidence-reviewer  read-only: only hashing / listing / reading commands, no redirection,
//                         no subshells or script blocks.
//
// Any other agent (including the main conversation) passes through untouched.
// BEST EFFORT BY DESIGN: it inspects the command line, so code that does its own HTTP (a node or
// python script, `node -e "fetch(...)"`, a request inside the Playwright spec) is not caught. The
// skills' instructions remain the primary control. Regression cases: scripts/test-guard.mjs.

import { appendFileSync, readFileSync } from "node:fs";

const EXECUTOR = "qa-test-executor";
const REVIEWER = "qa-evidence-reviewer";
// A command word: start of line, after a separator, or after a path (/usr/bin/curl, C:\...\curl.exe).
const WORD = String.raw`(^|[\s;|&(/\\])`;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // not our business if the payload is unreadable
}

// Plugin agents are namespaced ("qa-flow:qa-test-executor"); manual installs are not.
const agent = String(input.agent_type ?? "").split(":").pop();
const command = String(input.tool_input?.command ?? "");
const reason = agent === REVIEWER ? reviewerViolation(command)
  : agent === EXECUTOR ? executorViolation(command)
  : null;

// Troubleshooting: QA_FLOW_GUARD_LOG=<file> appends one line per call with the decision.
if (process.env.QA_FLOW_GUARD_LOG) {
  try {
    appendFileSync(process.env.QA_FLOW_GUARD_LOG, JSON.stringify({
      agent_type: input.agent_type ?? null, tool: input.tool_name, command, decision: reason ? "deny" : "pass",
    }) + "\n");
  } catch { /* logging must never break the hook */ }
}
if (!reason) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: `${agent}: ${reason} Return your report to the orchestrator instead — tracker writes happen only after review and user approval.`,
  },
}));
process.exit(0);

function executorViolation(cmd) {
  if (/\bgit\b[^|;&\n]*\s(commit|push)\b/i.test(cmd)) return "committing or pushing is not allowed for throwaway QA work.";

  const cli = WORD + String.raw`(gh|glab)(\.exe)?\s+`;
  if (new RegExp(cli + String.raw`(issue|pr|mr)\s+(create|comment|edit|close|reopen|note|delete|merge|review|update)\b`, "i").test(cmd) ||
      new RegExp(cli + String.raw`api\b.*(\s-X\s*\S|--method|\s-[fF]\s|--field|--raw-field|--input)`, "i").test(cmd)) {
    return "writing to the issue tracker through its CLI is blocked (comments, tickets and uploads belong to the orchestrator).";
  }

  const httpClient = new RegExp(WORD + String.raw`(curl|wget|xh|http|https|Invoke-RestMethod|Invoke-WebRequest|irm|iwr)(\.exe)?(\s|$)`, "i");
  if (!httpClient.test(cmd)) return null;

  const mutating = [
    /\s-[a-zA-Z]*X\s*['"]?(POST|PUT|PATCH|DELETE)\b/i,               // -X POST, -sX POST, -XPOST
    /--request[=\s]+['"]?(POST|PUT|PATCH|DELETE)\b/i,
    /\s-[a-zA-Z]*[dFT]/,                                              // -d, -d'..', -d@f, -sd, -Ffile=@a, -T (case-sensitive)
    /\s--(data[\w-]*|form[\w-]*|json|upload-file)\b/,
    /--(post-data|post-file|method|body-data|body-file)\b/i,          // wget
    /-Method\s+['"]?(Post|Put|Patch|Delete)\b/i,                      // PowerShell
    new RegExp(WORD + String.raw`(http|https|xh)\s+(POST|PUT|PATCH|DELETE)\b`, "i"), // HTTPie / xh
  ].some((re) => re.test(cmd)) || httpieImplicitPost(cmd);
  if (!mutating) return null;

  const urls = cmd.match(/https?:\/\/[^\s'"]+/gi) ?? [];
  if (urls.length > 0 && urls.every(isLocal)) return null;

  return "mutating HTTP calls to external hosts are blocked (tracker comments, tickets and uploads belong to the orchestrator).";
}

// HTTPie / xh send a POST when the command carries data items (`field=value`, `field:=json`).
function httpieImplicitPost(cmd) {
  const m = cmd.match(new RegExp(WORD + String.raw`(http|https|xh)(\.exe)?\s+(.*)$`, "i"));
  if (!m) return false;
  return m[4].split(/\s+/).some((t) => !/^https?:/i.test(t) && /^[\w.\-[\]]+(:=|=(?!=))/.test(t));
}

function isLocal(u) {
  try {
    const host = new URL(u).hostname.toLowerCase();
    return ["localhost", "127.0.0.1", "[::1]"].includes(host) || host.endsWith(".localhost") || host.endsWith(".test");
  } catch {
    return false;
  }
}

function reviewerViolation(cmd) {
  if (/`|\$\(|[<>]\(|[{}()]/.test(cmd)) return "subshells, script blocks and command substitution are not allowed for the read-only reviewer.";
  const withoutSafeRedirects = cmd.replace(/\d?>\s*(&\d|\/dev\/null|\$null|NUL)\b/gi, "");
  if (/>/.test(withoutSafeRedirects)) return "output redirection is not allowed for the read-only reviewer.";

  const allowed = /^(md5sum|sha1sum|sha256sum|shasum|md5|certutil\s+-hashfile|Get-FileHash|ls|dir|Get-ChildItem|gci|file|wc|stat|sort|uniq|head|tail|cat|type|Get-Content|gc|grep|Select-String|Group-Object|Where-Object|Select-Object|Measure-Object|Format-Table|ft|echo|Write-Output|cd|Set-Location|pwd)\b/i;
  const segments = cmd.split(/\|\||&&|[|;&\n]/).map((s) => s.trim()).filter(Boolean);
  const bad = segments.find((s) => !allowed.test(s) || writesFile(s));
  return bad ? `only hashing / listing / reading commands are allowed for the read-only reviewer (blocked: "${bad.slice(0, 60)}").` : null;
}

// Allowed commands that can still write a file through their own options.
function writesFile(segment) {
  if (/^sort\b/i.test(segment)) return /\s(-o|--output)/.test(segment);
  if (/^file\b/i.test(segment)) return /\s-[a-zA-Z]*C/.test(segment);
  if (/^uniq\b/i.test(segment)) return segment.split(/\s+/).slice(1).filter((a) => !a.startsWith("-")).length > 1;
  return false;
}
