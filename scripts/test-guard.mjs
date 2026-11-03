#!/usr/bin/env node
// Regression cases for scripts/guard-tracker-writes.mjs (black-box: pipes hook JSON to the script).
// Usage: node scripts/test-guard.mjs     — exits 1 on any mismatch. Runs in CI.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "guard-tracker-writes.mjs");
const EXE = "qa-flow:qa-test-executor";
const REV = "qa-flow:qa-evidence-reviewer";

// [agent_type, command, expected]
const CASES = [
  // executor — allowed
  [EXE, "node --version", "pass"],
  [EXE, "npx playwright test -c _local/scripts/manual.config.ts _manual-x", "pass"],
  [EXE, "curl -s https://api.tracker.example/stories/1", "pass"],
  [EXE, "curl -sSL -H 'Authorization: Bearer x' https://api.tracker.example/stories/1", "pass"],
  [EXE, "curl -X POST http://localhost:3000/api/seed -d a=1", "pass"],
  [EXE, "curl -X POST http://app.test/api/seed", "pass"],
  [EXE, "http GET https://api.tracker.example/x q==1", "pass"],
  [EXE, "gh issue view 12", "pass"],
  [EXE, "git status && git diff", "pass"],
  [EXE, "md5sum _local/evidence/x/*.png | sort | uniq -w32 -D", "pass"],
  // executor — denied
  [EXE, "curl -s -X POST https://api.tracker.example/stories/1/comments -d text=hi", "deny"],
  [EXE, "curl -sX POST https://api.tracker.example/x", "deny"],
  [EXE, "curl -XPOST https://api.tracker.example/x", "deny"],
  [EXE, "curl --request=PUT https://api.tracker.example/x", "deny"],
  [EXE, `curl -d'{"a":1}' https://api.tracker.example/x`, "deny"],
  [EXE, "curl -d@body.json https://api.tracker.example/x", "deny"],
  [EXE, "curl -sd a=1 https://api.tracker.example/x", "deny"],
  [EXE, "curl -Ffile0=@a.png https://api.tracker.example/files", "deny"],
  [EXE, "curl --json '{}' https://api.tracker.example/x", "deny"],
  [EXE, "/usr/bin/curl -X POST https://api.tracker.example/x", "deny"],
  [EXE, "C:\\Windows\\System32\\curl.exe -X POST https://api.tracker.example/x", "deny"],
  [EXE, "curl -X POST 'https://api.tracker.example/x#.test/'", "deny"],
  [EXE, "curl -X POST https://api.tracker.example/x?h=.test/", "deny"],
  [EXE, "curl -X POST http://localhost:3000/a https://api.tracker.example/b", "deny"],
  [EXE, "wget --post-data=a=1 https://api.tracker.example/x", "deny"],
  [EXE, "http https://api.tracker.example/x text=hi", "deny"],
  [EXE, "xh POST https://api.tracker.example/x", "deny"],
  [EXE, "Invoke-RestMethod -Method Post -Uri https://api.tracker.example/x", "deny"],
  [EXE, "gh issue comment 12 --body hi", "deny"],
  [EXE, "gh pr comment 3 -b hi", "deny"],
  [EXE, "gh api -X POST repos/o/r/issues", "deny"],
  [EXE, "gh api repos/o/r/issues -f title=x", "deny"],
  [EXE, "glab mr note 4 -m hi", "deny"],
  [EXE, "git commit -m x", "deny"],
  [EXE, "git -C . commit -m x", "deny"],
  [EXE, "git push origin HEAD", "deny"],
  // executor — second review: wrappers, quotes, abbreviations, other CLIs
  [EXE, `bash -c "curl -d @x https://api.tracker.example/x"`, "deny"],
  [EXE, "sh -c 'gh issue comment 1 -b hi'", "deny"],
  [EXE, `"curl" -d a=1 https://api.tracker.example/x`, "deny"],
  [EXE, `& "curl.exe" -X POST https://api.tracker.example/x`, "deny"],
  [EXE, "$(command -v curl) -d a=1 https://api.tracker.example/x", "deny"],
  [EXE, "gh api repos/o/r/issues -fbody=hi", "deny"],
  [EXE, "gh api repos/o/r/issues -Fbody=@f.md", "deny"],
  [EXE, "gh label create qa", "deny"],
  [EXE, "jira issue comment add PROJ-1 hi", "deny"],
  [EXE, "echo '{}' | http https://api.tracker.example/x", "deny"],
  [EXE, "http https://api.tracker.example/x < body.json", "deny"],
  [EXE, "http --raw '{}' https://api.tracker.example/x", "deny"],
  [EXE, "http --multipart https://api.tracker.example/files file@a.png", "deny"],
  [EXE, "Invoke-RestMethod -Meth Post https://api.tracker.example/x", "deny"],
  [EXE, "git merge feature", "deny"],
  [EXE, "git -c user.name=x commit -m y", "deny"],
  // executor — must stay allowed (false positives found in review)
  [EXE, "Invoke-RestMethod -Method Get https://api.tracker.example/x", "pass"],
  [EXE, "Invoke-WebRequest https://api.tracker.example/x -OutFile out.json", "pass"],
  [EXE, "curl -s https://api.tracker.example/x | cut -d, -f1", "pass"],
  [EXE, "curl -s https://api.tracker.example/x | grep -F total", "pass"],
  [EXE, "git log --grep commit --oneline", "pass"],
  [EXE, "http GET https://api.tracker.example/x", "pass"],
  // reviewer — allowed
  [REV, "ls", "pass"],
  [REV, "ls _local/evidence 2>/dev/null", "pass"],
  [REV, "md5sum _local/evidence/x/*.png | sort | uniq -w32 -D", "pass"],
  [REV, "Get-FileHash _local\\evidence\\x\\*.png -Algorithm MD5 | Group-Object Hash | Where-Object Count -gt 1", "pass"],
  [REV, "cat _local/logs/run.log | grep -n FAIL", "pass"],
  [REV, "head -50 _local/scripts/_manual-x.spec.ts", "pass"],
  // reviewer — denied
  [REV, "echo x > reviewer.txt", "deny"],
  [REV, "ls >> out.txt", "deny"],
  [REV, "ls; touch r2.txt", "deny"],
  [REV, "ls & rm -rf x", "deny"],
  [REV, "cat <(rm x)", "deny"],
  [REV, "cat $(rm x)", "deny"],
  [REV, "sort a.txt -o out.txt", "deny"],
  [REV, "uniq in.txt out.txt", "deny"],
  [REV, "file -C -m magic", "deny"],
  [REV, "Get-ChildItem | Where-Object { Remove-Item $_ }", "deny"],
  [REV, "cat (Remove-Item x)", "deny"],
  [REV, "ls | xargs rm", "deny"],
  [REV, "npx playwright test", "deny"],
  [REV, "node --version", "deny"],
  [REV, "tee out.txt", "deny"],
  // reviewer — second review
  [REV, "sort -uo out.txt in.txt", "deny"],
  [REV, "file --compile -m magic", "deny"],
  [REV, "echo x > $null.txt", "deny"],
  [REV, "echo x > $null/tmp/evil", "deny"],
  [REV, "echo x > NUL.txt", "deny"],
  [REV, "ls >/dev/null.txt", "deny"],
  [REV, "cat run.log 2>&1 | head -20", "pass"],
  [REV, "Get-ChildItem _local > $null", "pass"],
  // executor — knowledge bank: reading allowed, shell writes denied
  [EXE, "cat .qa-flow/knowledge/listings.md", "pass"],
  [EXE, "grep -n locator .qa-flow/knowledge/*.md", "pass"],
  [EXE, "node ~/.claude/skills/manual-test/scripts/check-knowledge.mjs .qa-flow/knowledge --json", "pass"],
  [EXE, "node check-knowledge.mjs .qa-flow/knowledge 2>/dev/null", "pass"],
  [EXE, "echo '## x' >> .qa-flow/knowledge/listings.md", "deny"],
  [EXE, "cp _local/notes.md .qa-flow/knowledge/listings.md", "deny"],
  [EXE, "rm -f .qa-flow/knowledge/old.md", "deny"],
  [EXE, "sed -i 's/a/b/' .qa-flow/knowledge/listings.md", "deny"],
  [EXE, "Set-Content -Path .qa-flow\\knowledge\\listings.md -Value x", "deny"],
  [EXE, "Add-Content \".qa-flow/knowledge/x.md\" 'y'", "deny"],
  [EXE, "tee -a /repo/.qa-flow/knowledge/x.md < notes", "deny"],
  [EXE, "echo hi > _local/notes/qa-flow-knowledge.md", "pass"],
  // second review — reads that must not be denied, by destination
  [EXE, "node check-knowledge.mjs .qa-flow/knowledge --json > _local/kb.json", "pass"],
  [EXE, "cp .qa-flow/knowledge/listings.md _local/", "pass"],
  [EXE, "mkdir -p _local/recon && cat .qa-flow/knowledge/listings.md", "pass"],
  [EXE, "grep \"->\" .qa-flow/knowledge/listings.md", "pass"],
  [EXE, "Copy-Item .qa-flow\\knowledge\\x.md -Destination _local\\x.md", "pass"],
  [EXE, "Copy-Item _local\\x.md -Destination .qa-flow\\knowledge\\x.md", "deny"],
  [EXE, "cat notes.md > \".qa-flow/knowledge/new.md\"", "deny"],
  [EXE, "mv _local/x.md /repo/.qa-flow/knowledge/", "deny"],
  // third review — redirection glued to the path, odd separators, moving out of the bank
  [EXE, "echo x >.qa-flow/knowledge/a.md", "deny"],
  [EXE, "echo x>>.qa-flow/knowledge/a.md", "deny"],
  [EXE, "node gen.mjs 1>>.qa-flow/knowledge/a.md", "deny"],
  [EXE, "echo x > ./.qa-flow/./knowledge/a.md", "deny"],
  [EXE, "echo x > repo//.qa-flow//knowledge/a.md", "deny"],
  [EXE, "mv .qa-flow/knowledge/a.md _local/", "deny"],
  [EXE, "Copy-Item -Dest .qa-flow\\knowledge\\x.md -Path _local\\x.md", "deny"],
  [EXE, "cat .qa-flow/knowledge/a.md 2>/dev/null | head -5", "pass"],
  // fourth review — wrappers, git, other writers, the parent folder, inputs after `<`
  [EXE, "sudo rm .qa-flow/knowledge/a.md", "deny"],
  [EXE, "env X=1 tee .qa-flow/knowledge/a.md", "deny"],
  [EXE, "bash -c \"rm .qa-flow/knowledge/a.md\"", "deny"],
  [EXE, "git rm .qa-flow/knowledge/a.md", "deny"],
  [EXE, "git restore .qa-flow/knowledge/a.md", "deny"],
  [EXE, "unlink .qa-flow/knowledge/a.md", "deny"],
  [EXE, "dd if=x of=.qa-flow/knowledge/a.md", "deny"],
  [EXE, "echo x >| .qa-flow/knowledge/a.md", "deny"],
  [EXE, "Copy-Item x.md -Destination:.qa-flow\\knowledge\\x.md", "deny"],
  [EXE, "rm -rf .qa-flow", "deny"],
  [EXE, "Remove-Item -Recurse .qa-flow", "deny"],
  [EXE, "tee _local/logs/a.txt < .qa-flow/knowledge/a.md", "pass"],
  [EXE, "git diff .qa-flow/knowledge/a.md", "pass"],
  [EXE, "git log -- .qa-flow/knowledge", "pass"],
  [EXE, "ls .qa-flow", "pass"],
  // other agents / main conversation — untouched
  [undefined, "curl -X POST https://api.tracker.example/x", "pass"],
  ["Explore", "git commit -m x", "pass"],
  [undefined, "echo x >> .qa-flow/knowledge/listings.md", "pass"],
];

// File-editing tools: [agent_type, tool_name, file_path, expected]
const FILE_CASES = [
  [EXE, "Write", "C:\\repo\\_local\\scripts\\_manual-x.spec.ts", "pass"],
  [EXE, "Edit", "/repo/_local/scripts/manual.config.ts", "pass"],
  [EXE, "Write", "/repo/.qa-flow/knowledge/listings.md", "deny"],
  [EXE, "Edit", "C:\\repo\\.qa-flow\\knowledge\\_environment.md", "deny"],
  [EXE, "MultiEdit", ".qa-flow/knowledge/checkout.md", "deny"],
  [EXE, "Write", "/repo/docs/qa-flow/knowledge-notes.md", "pass"],
  [EXE, "Write", "C:/repo/.qa-flow//knowledge/a.md", "deny"],
  [EXE, "Write", "C:/repo/.qa-flow/./knowledge/a.md", "deny"],
  [EXE, "Edit", "C:/repo/x/../.qa-flow/knowledge/a.md", "deny"],
  [REV, "Write", "/repo/_local/review.md", "deny"],
  [REV, "Edit", "/repo/_local/scripts/x.ts", "deny"],
  [undefined, "Write", "/repo/.qa-flow/knowledge/listings.md", "pass"],
  ["Explore", "Edit", "/repo/.qa-flow/knowledge/listings.md", "pass"],
];

let failed = 0;
const all = [
  ...CASES.map(([agent_type, command, expected]) => [agent_type, "Bash", { command }, expected, command]),
  ...FILE_CASES.map(([agent_type, tool, file_path, expected]) => [agent_type, tool, { file_path }, expected, `${tool} ${file_path}`]),
];
for (const [agent_type, tool_name, tool_input, expected, label] of all) {
  const payload = JSON.stringify({ agent_type, tool_name, tool_input });
  const run = spawnSync(process.execPath, [GUARD], { input: payload, encoding: "utf8" });
  const actual = run.status !== 0 ? `error(${run.status}): ${run.stderr.trim()}`
    : run.stdout.includes('"permissionDecision":"deny"') ? "deny" : "pass";
  if (actual !== expected) {
    failed++;
    console.error(`FAIL [${agent_type ?? "main"}] expected ${expected}, got ${actual}: ${label}`);
  }
}

console.log(`${all.length - failed}/${all.length} guard cases passed`);
process.exit(failed ? 1 : 0);
