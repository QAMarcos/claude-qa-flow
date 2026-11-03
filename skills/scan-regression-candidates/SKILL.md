---
name: scan-regression-candidates
description: Sweep a QA scratch root (default `_local/`, where manual-test keeps its throwaway scripts, evidence and logs) and list the few scenarios worth turning into committed regression tests — scored for value and cost, checked against the existing suite, with probes, one-offs and already-covered flows filtered out as noise. Read-only; produces a ranked backlog report and hands chosen candidates to promote-to-regression. Use whenever the user asks to "varrer a pasta local", "find regression candidates", "o que vale automatizar?", "which manual tests should become automated", "levantar testes pendentes de automação", or wants a backlog of automation from past manual runs.
license: MIT
compatibility: Any Agent Skills harness (Claude Code, OpenCode, Codex, ...). Needs shell access and Node.js ≥ 18 for the bundled inventory script. Subagents recommended.
metadata:
  version: "2.1.0"
  routing: router
---

# Scan Regression Candidates

Months of manual QA leave hundreds of throwaway scripts, evidence folders and logs in the scratch
root. Some of them describe flows the team re-tests by hand every release, or bugs that came back
after being fixed — those are worth a permanent regression test. Most are probes, one-off checks and
investigations that would only add noise to a suite.

This skill reads the scratch root (never writes to it), groups what it finds into scenarios, scores
each with the same criteria `promote-to-regression` uses, checks the committed suite for existing
coverage, and returns a **short** ranked backlog. It does not write tests: the user picks candidates,
and `promote-to-regression` promotes them one at a time.

## Step 0 — Triage & delegation (mandatory)

This skill is a **router**. Main conversation: resolve the inputs below (ask only for what you cannot
infer), dispatch one scanner subagent (`deep` tier — it is judgement over many weak signals), then
show its report and ask which candidates to promote. Without subagents, run Steps 1–4 yourself.

Inputs to resolve before dispatching:

- **Scratch root** — default `_local/` in the current project. Several are fine (web and mobile).
- **Committed suite** — where the regression specs live (read the Playwright config's `testDir`), to
  check coverage. Without it, every candidate is marked "coverage not checked".
- **Ticket pattern** — how ticket ids appear in file and folder names (e.g. `sc-?\d{5}`,
  `PROJ-\d+`). Infer it from a listing of the scripts folder; the default catches `ABC-123` and
  `sc123`. If the prefix is optional in practice (`_manual-1042-…`), also pass an **id range**
  (`--id-range 1000-1999`) so record ids, timestamps and ports in logs are not read as tickets.
- **Window** (optional) — only runs after a date (`--since`).
- **Output** — default `<scratch root>/regression-candidates/<date>.md`, a **new** folder — or any
  folder outside the scratch root the user prefers. That is the only thing this skill writes;
  everything already in the scratch root is read-only. Other tools may still be writing into the
  scratch root while you scan: note the inventory's timestamp in the report.

Scanner brief:

```
Read <absolute path>/scan-regression-candidates/SKILL.md and run Steps 1–4. Read-only on the scratch
root and the suite. Scratch root: <path>. Suite: <path>. Ticket pattern: <regex>. Window: <…>.
Write the report to <output path>. Do not ask anything; return the report's path and its summary.
```

## Step 1 — Inventory (mechanical)

Run the bundled script from the project root:

```bash
node <this skill's dir>/scripts/inventory.mjs <scratch root> --ticket "<regex>" [--id-range <min>-<max>] [--since <date>] --top 120 --out <scratch root>/regression-candidates/inventory.json
```

Groups are keyed by the ticket **number**, so two projects whose keys share a number (`ABC-12`,
`XYZ-12`) merge — pass a stricter `--ticket` when a scratch root mixes projects. Free text it keeps
(test titles, step names) is redacted (emails, phones, tokens, long numbers) and paths are collapsed
to routes; review the inventory before sharing it anyway.

It groups scripts, evidence folders, logs and reports by ticket — taken from **any** path component,
so `scripts/ABC-1042-retest/recon.spec.ts` belongs to #1042 — or by name stem, and records per group:
dates and active days, number of specs vs. probe scripts, evidence folders, verdicts found in
`manual-test`'s saved results (`_local/reports/`), reports, comment drafts and ledgers — counted once
per file, with the group's `latest_verdict` (value, date, file, `reviewed`) and
`latest_reviewed_verdict` — a saved result's `reviewer_verdict` is the reviewed one — so "a later
`PASS` after the `FAIL`" can be read off directly — test titles, `test.step` names, visited paths (origin and query
string removed, ids collapsed), `expect` count and red flags (hard waits, force clicks). It **never**
reads folders named `secrets`, `state`, `.auth`, `worktrees`, `node_modules`, `test-results`,
`playwright-report*`, `allure-*`, nor files whose name suggests credentials or browser state — and it
extracts no values from scripts beyond titles, step names and paths.

**Dates.** A date in the path wins over the file's modification time; `dates_from_names` says how
many of a group's dates came from names. File times are unreliable after bulk copies or touches —
when most dates are mtimes and many groups share the same day, do not trust `active_days` as
recurrence; count distinct re-test runs (retest / pass-2 folders, dated evidence) instead.

**Look for a tracker export** in the scratch root (a JSON / CSV of stories with titles, types and
workflow states). With no tracker access, it is the best answer to "what is this ticket" and "was the
bug fixed": a bug in a done/completed state plus a later `PASS` re-test is a fixed bug.

**Privacy rule for the rest of the scan:** you may open specs, reports and run notes to understand a
group, but never open `storageState`/auth files, `.env*`, token files, or anything under the skipped
folders, and never copy credentials, tokens, emails or personal data into the report.

## Step 2 — Understand the strong groups

Work from the inventory, not from a full read of the folder. For each group that is not obviously
noise (see below), read just enough to answer:

- **What user-meaningful outcome** was being checked? (from titles, steps, paths; open the main spec
  and the report/notes if any — not every script.)
- **What happened?** Accepted `PASS`, a bug found (and was it fixed and re-tested?), or only probes.
- **How often** did this flow come back — other tickets touching the same paths, re-tests, passes 2/3?
- **Is it covered?** Search the committed suite for the route and the outcome (grep the paths,
  feature words, page-object names). Partial coverage → "extend <spec>", not a new test.

Fold groups that test the same flow (same paths and outcome across tickets) into one candidate.

Obvious noise — count by category, do not analyse one by one:

- groups with only probe/recon/diag/annotate/crop scripts;
- login / session / seeding helpers, configs, shared libs (`lib`, `config`, `global-setup`);
- data or API investigations with no UI outcome (unless the suite also covers APIs);
- runs with no accepted result (`BLOCKED` / `INCONCLUSIVE` / `PO-DECISION` only);
- groups seen once, on one day, with a narrow, ticket-specific assertion (copy of a banner, one
  pixel layout at one width);
- **a different surface than the suite** — mobile app, an admin tool, infrastructure or monitoring
  config — unless the suite has a harness for it;
- **suite-authoring sweeps** — the runs that produced specs already committed (folders named after a
  suite area or a "regression"/"recon" sweep): they are covered by definition.

**Runs older than saved reviews.** Scratch roots that predate `<scratch root>/reports/` have no
reviewer sign-off. Treat a run as reviewed when there is a reviewer-style artefact (a review file, a
second-pass verdict) or the ticket moved past QA in the tracker or its export — and mark it
`review: inferred` in the report. A `PASS` with neither stays `MAYBE`.

**Recurrence vs. bug re-tests.** Re-tests of a bug count toward bug history, not recurrence; recurrence
is feature passes, release / regression sweeps and other tickets exercising the same flow.

**An open question on one step only.** Drop that step from the candidate (which can stay `PROMOTE`)
and list it as its own `MAYBE` with the question.

**`--top` cuts.** The inventory lists `dropped_ticket_groups`: if any look relevant, re-run with a
higher `--top` instead of ignoring them.

## Step 3 — Score

Score each remaining candidate with
[`../promote-to-regression/references/promotion-criteria.md`](../promote-to-regression/references/promotion-criteria.md)
(installed next to this skill; if it is missing, stop and say so — do not improvise a rubric):
`value V/7 · cost C/7`, one line per non-zero criterion, then `PROMOTE` / `MAYBE` / `SKIP`.

Be strict. The point of the report is a short list the user can trust. A backlog of 40 "PROMOTE"
items is a failed scan: if more than ~10 survive, raise the bar (higher value first, then lower cost)
and move the rest to `MAYBE` with a reason.

## Step 4 — Report

Write the report (English, Markdown) with:

1. **Summary** — scratch root(s), window, groups found, how many were noise (by category, with
   counts), how many scored, how many `PROMOTE` / `MAYBE`.
2. **PROMOTE** — ranked. For each: a one-line title of the outcome; tickets; the evidence it rests
   on (spec paths, report verdicts, dates); the score with its per-criterion lines; existing
   coverage ("none found in <suite>" / "extend <spec>"); the shape of the test (one paragraph:
   entry, the steps, the key assertions — from the ACs or product rules, never from the screen);
   what it needs (fixture user, seeding helper, page object) and open questions.
3. **MAYBE** — one line each: what is missing for it to become `PROMOTE`.
4. **SKIP highlights** — only the non-obvious ones (a group that looks important but is covered, or
   too flaky), one line each.
5. **Limits** — what could not be checked (no tracker access to confirm a bug was fixed, suite not
   searchable, scripts unreadable).

Return to the orchestrator: the report path and a ≤ 10-line summary.

## After the report (main conversation)

Show the summary and the `PROMOTE` list, and ask which candidates (if any) to promote. For each one
the user picks, run `promote-to-regression` with that candidate — one at a time; it has its own gates
before anything is written to the suite or committed.

## Rules

- **Read-only.** Never modify, move or delete anything in the scratch root or the suite; the only
  write is the new `regression-candidates/` report folder (or the output path the user gave).
- **No secrets, no personal data** — not read, not copied, not summarised.
- **Strong over many.** Few, well-argued candidates beat a long list. "Tested once" is not a reason.
- **Expected behaviour comes from tickets and product rules.** If a candidate's expected values can
  only be taken from what a manual run saw, it is at most `MAYBE` ("needs the AC").
- **Say what you could not verify** — especially "bug fixed?" and "already covered?".
