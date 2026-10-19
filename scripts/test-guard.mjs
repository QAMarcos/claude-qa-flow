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
  // other agents / main conversation — untouched
  [undefined, "curl -X POST https://api.tracker.example/x", "pass"],
  ["Explore", "git commit -m x", "pass"],
];

let failed = 0;
for (const [agent_type, command, expected] of CASES) {
  const payload = JSON.stringify({ agent_type, tool_name: "Bash", tool_input: { command } });
  const run = spawnSync(process.execPath, [GUARD], { input: payload, encoding: "utf8" });
  const actual = run.status !== 0 ? `error(${run.status}): ${run.stderr.trim()}`
    : run.stdout.includes('"permissionDecision":"deny"') ? "deny" : "pass";
  if (actual !== expected) {
    failed++;
    console.error(`FAIL [${agent_type ?? "main"}] expected ${expected}, got ${actual}: ${command}`);
  }
}

console.log(`${CASES.length - failed}/${CASES.length} guard cases passed`);
process.exit(failed ? 1 : 0);
