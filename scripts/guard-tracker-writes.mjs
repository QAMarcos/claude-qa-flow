#!/usr/bin/env node
// Claude Code PreToolUse hook (Bash / PowerShell / Write / Edit). Backs up the role boundaries of
// the manual-test subagents, so common violations are blocked even if the model ignores its
// instructions:
//
//   qa-test-executor      may run anything EXCEPT mutating HTTP calls to non-local hosts, tracker
//                         CLI writes (gh/glab), git commit/push, and writes to the knowledge bank
//                         (.qa-flow/knowledge/ — by file tool or by an obvious shell write).
//   qa-evidence-reviewer  read-only: only hashing / listing / reading commands, no redirection,
//                         no subshells or script blocks, no file-editing tools.
//
// Any other agent (including the main conversation) passes through untouched.
// BEST EFFORT BY DESIGN: it inspects the command line, so code that does its own HTTP (a node or
// python script, `node -e "fetch(...)"`, a request inside the Playwright spec) is not caught. The
// skills' instructions remain the primary control. Regression cases: scripts/test-guard.mjs.

import { appendFileSync, readFileSync } from "node:fs";

const EXECUTOR = "qa-test-executor";
const REVIEWER = "qa-evidence-reviewer";
// A command word: start of line, after a separator, or after a path (/usr/bin/curl, C:\...\curl.exe).
// Quotes count too, so wrappers like `bash -c "curl ..."` and `& "curl.exe" ...` are recognised.
const WORD = String.raw`(^|[\s;|&(/\\"'])`;
const WORD_END = String.raw`(\.exe)?(?=["')\s]|$)`;
const FILE_TOOLS = /^(Write|Edit|MultiEdit|NotebookEdit)$/;
// The default knowledge root. A project that moved it elsewhere is covered by the instructions only.
const KNOWLEDGE = /(^|[\s"'=:/\\])\.qa-flow[/\\]knowledge([/\\\s"']|$)/i;
// `.qa-flow` itself — deleting or moving it takes the bank with it.
const BANK_PARENT = /(^|[\s"'=/\\])\.qa-flow[/\\]?(?=["'\s]|$)/i;

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  process.exit(0); // not our business if the payload is unreadable
}

// Plugin agents are namespaced ("qa-flow:qa-test-executor"); manual installs are not.
const agent = String(input.agent_type ?? "").split(":").pop();
const tool = String(input.tool_name ?? "");
const command = String(input.tool_input?.command ?? "");
const filePath = String(input.tool_input?.file_path ?? input.tool_input?.notebook_path ?? "");
const reason = FILE_TOOLS.test(tool) ? fileToolViolation(agent, filePath)
  : agent === REVIEWER ? reviewerViolation(command)
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
    permissionDecisionReason: `${agent}: ${reason} Return your report to the orchestrator instead — tracker and knowledge-bank writes happen only after review and user approval.`,
  },
}));
process.exit(0);

function fileToolViolation(who, path) {
  if (who === REVIEWER) return "the read-only reviewer may not create or edit files.";
  if (who === EXECUTOR && KNOWLEDGE.test(normalisePath(path))) {
    return "the knowledge bank is curated by the orchestrator with the user's approval; propose the entry in your report.";
  }
  return null;
}

// An obvious shell write INTO the knowledge bank, judged per command segment and by destination:
// a redirection whose target is in the bank, `cp`/`mv`/`install`/`ln`/`Copy-Item`/`Move-Item` whose
// last argument (or -Destination) is in the bank, or a command that edits or deletes its arguments
// in place (rm, tee, touch, sed -i, Set-Content, …) with an argument in the bank. Reading the bank —
// cat, grep, the checker, `cp` out of it, the checker's output redirected elsewhere — stays allowed.
// A move OUT of the bank deletes the entry, so `mv`/`Move-Item` count with the bank on either side;
// deleting `.qa-flow` itself counts too. Paths are normalised first (`//`, `/./`, `x/../`), a
// redirection may touch the path (`>.qa-flow/…`, `>|`), wrappers are unwrapped (`sudo`, `env X=1`,
// `nohup`, `bash -c "…"`), and words after `<` are inputs, not targets.
// Known gaps (best effort): `cd .qa-flow && echo >> knowledge/x`, `cp -t <dir>`, `find -delete`,
// `xargs rm`, `rsync`, `tar -C`, piping paths into `Remove-Item`, wrappers with their own options
// (`bash -lc '…'`, `sudo -u x tee`, `env -i rm`, `git -C . rm`), and code that writes files itself
// (`node -e "fs.appendFileSync(...)"`).
function normalisePath(p) {
  let s = p.replace(/\\/g, "/").replace(/\/(?:\.\/)+/g, "/").replace(/\/{2,}/g, "/");
  while (/\/[^/.][^/]*\/\.\.\//.test(s)) s = s.replace(/\/[^/.][^/]*\/\.\.\//, "/");
  return s;
}

function writesKnowledge(rawCmd) {
  const cmd = normalisePath(rawCmd);
  if (!KNOWLEDGE.test(cmd) && !/>\|?\s*\.qa-flow\/knowledge/i.test(cmd) && !BANK_PARENT.test(cmd)) return false;
  return cmd.split(/\|\||&&|(?<!>)\||[;\n]/).some(segmentWritesKnowledge);
}

function segmentWritesKnowledge(rawSeg) {
  // Unwrap `bash -c "…"` / `pwsh -Command "…"` and judge the inner command.
  const shell = rawSeg.match(/(?:^|\s)(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+(?:-\w+\s+)*-c(?:ommand)?\s+(["'])([\s\S]*)\1/i);
  if (shell) return writesKnowledge(shell[2]);
  for (const m of rawSeg.matchAll(/\d?>[>|]?\s*("[^"]*"|'[^']*'|[^\s"'|;&]+)/g)) {
    if (KNOWLEDGE.test(" " + m[1].replace(/^["']|["']$/g, ""))) return true;
  }
  let words = rawSeg.trim().split(/\s+/);
  // Drop wrappers and leading `VAR=value` assignments.
  while (words.length && /^(sudo|env|nohup|command|time|exec|nice|\w+=\S*)$/i.test(words[0])) words = words.slice(1);
  const lt = words.indexOf("<");
  if (lt !== -1) words = words.slice(0, lt);
  const name = (words[0] ?? "").replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
  const rest = words.slice(1);
  const inBank = (w) => KNOWLEDGE.test(" " + w.replace(/^-\w+:/, ""));
  const deletesBank = (w) => BANK_PARENT.test(" " + w);
  if (/^(mv|Move-Item|mi|move)$/i.test(name)) return rest.some(inBank) || rest.some(deletesBank);
  if (/^(cp|install|ln|Copy-Item|cpi|copy)$/i.test(name)) {
    const glued = rest.find((w) => /^-Dest(ination)?:/i.test(w));
    const dest = rest.findIndex((w) => /^-Dest(ination)?$/i.test(w));
    const target = glued ? glued : dest !== -1 ? rest[dest + 1] : rest.filter((w) => !w.startsWith("-")).pop();
    return Boolean(target && inBank(target));
  }
  if (/^git$/i.test(name) && /^(rm|mv|restore|checkout|clean|stash)$/i.test(rest[0] ?? "")) return rest.some(inBank) || rest.some(deletesBank);
  if (/^dd$/i.test(name)) return rest.some((w) => /^of=/i.test(w) && inBank(w.slice(3)));
  if (/^(rm|rmdir|del|erase|unlink|touch|tee|mkdir|truncate|patch|Set-Content|Add-Content|Out-File|New-Item|Remove-Item|Rename-Item|Clear-Content|ni|sc|ac|ri|rni)$/i.test(name) ||
      (/^sed$/i.test(name) && rest.some((w) => /^(-[a-zA-Z]*i|--in-place)/.test(w))) ||
      (/^perl$/i.test(name) && rest.some((w) => /^-[a-zA-Z]*i/.test(w)))) {
    return rest.some(inBank) || (/^(rm|rmdir|del|erase|Remove-Item|ri)$/i.test(name) && rest.some(deletesBank));
  }
  return false;
}

function executorViolation(cmd) {
  if (writesKnowledge(cmd)) {
    return "the knowledge bank is curated by the orchestrator with the user's approval; propose the entry in your report.";
  }
  // Anything that creates or publishes commits — `git log --grep commit` stays allowed.
  if (/\bgit\b(\s+(-[cC]\s+\S+|--?[\w.-]+(=\S+)?))*\s+(commit|push|merge|rebase|cherry-pick|revert|am)\b/i.test(cmd)) {
    return "committing or pushing is not allowed for throwaway QA work.";
  }

  const cli = (name) => WORD + name + WORD_END + String.raw`\s+`;
  if (new RegExp(cli("(gh|glab)") + String.raw`(issue|pr|mr)\s+(create|comment|edit|close|reopen|note|delete|merge|review|update)\b`, "i").test(cmd) ||
      new RegExp(cli("(gh|glab)") + String.raw`(project|label|release)\s+(create|edit|delete|item-add|item-edit|upload)\b`, "i").test(cmd) ||
      new RegExp(cli("(gh|glab)") + String.raw`api\b.*(\s-X\s*\S|--method|\s-[fF]|--field|--raw-field|--input)`, "i").test(cmd) ||
      new RegExp(cli("jira") + String.raw`(issue|epic|sprint)\s+(create|comment|edit|assign|move|link|delete)\b`, "i").test(cmd)) {
    return "writing to the issue tracker through its CLI is blocked (comments, tickets and uploads belong to the orchestrator).";
  }

  // Judge each pipeline segment on its own, so `curl URL | cut -d,` is not mistaken for `curl -d`.
  const segments = cmd.split(/\|\||&&|[|;\n]/);
  const mutating = segments.some((seg, i) => segmentMutates(seg, i > 0));
  if (!mutating) return null;

  const urls = cmd.match(/https?:\/\/[^\s'"]+/gi) ?? [];
  if (urls.length > 0 && urls.every(isLocal)) return null;

  return "mutating HTTP calls to external hosts are blocked (tracker comments, tickets and uploads belong to the orchestrator).";
}

function segmentMutates(seg, receivesPipe) {
  if (new RegExp(WORD + "(curl|wget)" + WORD_END, "i").test(seg)) {
    return [
      /\s-[a-zA-Z]*X\s*['"]?(POST|PUT|PATCH|DELETE)\b/i,               // -X POST, -sX POST, -XPOST
      /--request[=\s]+['"]?(POST|PUT|PATCH|DELETE)\b/i,
      /\s-[a-zA-Z]*[dFT]/,                                              // -d, -d'..', -d@f, -sd, -Ffile=@a, -T (case-sensitive)
      /\s--(data[\w-]*|form[\w-]*|json|upload-file)\b/,
      /--(post-data|post-file|method|body-data|body-file)\b/i,          // wget
    ].some((re) => re.test(seg));
  }
  if (new RegExp(WORD + "(Invoke-RestMethod|Invoke-WebRequest|irm|iwr)" + WORD_END, "i").test(seg)) {
    return /\s-Meth[a-z]*\s*[:\s]\s*['"]?(Post|Put|Patch|Delete)\b/i.test(seg);
  }
  const httpie = seg.match(new RegExp(WORD + "(http|https|xh)" + WORD_END + String.raw`\s+(.*)$`, "i"));
  if (httpie) {
    const rest = httpie[4];
    if (receivesPipe || /(^|\s)<\s*\S/.test(rest)) return true;                  // stdin body
    if (/^(POST|PUT|PATCH|DELETE)\b/i.test(rest)) return true;                   // explicit method
    if (/(^|\s)(--raw|--multipart|-f|--form)\b/.test(rest)) return true;
    return rest.split(/\s+/).some((t) => !/^https?:/i.test(t) && /^[\w.\-[\]]+(:=|=(?!=)|@)/.test(t)); // data items
  }
  return false;
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
  // Strip only exact discard targets (`2>/dev/null`, `2>&1`, `> $null`), not `> $null.txt`.
  const withoutSafeRedirects = cmd.replace(/\d?>\s*(&\d|\/dev\/null|\$null|NUL)(?=$|[\s|;&])/gi, "");
  if (/>/.test(withoutSafeRedirects)) return "output redirection is not allowed for the read-only reviewer.";

  const allowed = /^(md5sum|sha1sum|sha256sum|shasum|md5|certutil\s+-hashfile|Get-FileHash|ls|dir|Get-ChildItem|gci|file|wc|stat|sort|uniq|head|tail|cat|type|Get-Content|gc|grep|Select-String|Group-Object|Where-Object|Select-Object|Measure-Object|Format-Table|ft|echo|Write-Output|cd|Set-Location|pwd)\b/i;
  const segments = withoutSafeRedirects.split(/\|\||&&|[|;&\n]/).map((s) => s.trim()).filter(Boolean);
  const bad = segments.find((s) => !allowed.test(s) || writesFile(s));
  return bad ? `only hashing / listing / reading commands are allowed for the read-only reviewer (blocked: "${bad.slice(0, 60)}").` : null;
}

// Allowed commands that can still write a file through their own options.
function writesFile(segment) {
  if (/^sort\b/i.test(segment)) return /\s(-[a-zA-Z]*o|--output)/.test(segment);
  if (/^file\b/i.test(segment)) return /\s(-[a-zA-Z]*C|--compile)/.test(segment);
  if (/^uniq\b/i.test(segment)) return segment.split(/\s+/).slice(1).filter((a) => !a.startsWith("-")).length > 1;
  return false;
}
