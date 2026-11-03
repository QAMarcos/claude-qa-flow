---
name: promote-to-regression
description: Turn ONE reviewed manual QA run (a throwaway Playwright script + its report and evidence) into a committed regression spec in the project's e2e suite — only if the scenario is strong enough to earn a permanent place, rewritten in the suite's own conventions, proven stable and proven able to fail, and independently reviewed before anything is committed. Use whenever the user asks to "promote this test", "promover para regressão", "turn this manual test into an automated one", "add this scenario to the suite", "automatizar esse cenário", or picks a candidate from scan-regression-candidates. Never commits or opens a merge request without the user's explicit OK.
license: MIT
compatibility: Any Agent Skills harness (Claude Code, OpenCode, Codex, ...). Needs shell access, Node.js and the project's @playwright/test suite. Subagents recommended.
metadata:
  version: "2.1.0"
  routing: router
---

# Promote to Regression

Takes **one** scenario that was tested by hand — usually a `manual-test` run, with its throwaway
script under `_local/scripts/`, its report and its evidence — and, if it is worth it, turns it into a
spec that lives in the project's committed e2e suite.

Two things make this harder than copying the throwaway script:

1. **Most manual scenarios should not become regression tests.** A suite is paid for on every run;
   one-off checks become noise and flake. The gate in Step 2 says no more often than yes.
2. **The throwaway script is the wrong shape.** It was written to *investigate*: it logs, dumps
   text, takes evidence screenshots, hard-codes a staging URL, and sometimes asserts what the screen
   showed rather than what the ticket promised. A regression spec asserts the promise, through the
   suite's own fixtures and page objects, and nothing else.

> Pairs with `manual-test` (produces the runs) and `scan-regression-candidates` (finds which runs in a
> scratch root are worth promoting). This skill handles one scenario at a time.

## Model tiers used below

| Tier | Meaning |
|---|---|
| `balanced` | Follows a documented playbook well (Sonnet-class, GPT standard, Gemini Pro-class) |
| `deep` | Open-ended reasoning, judgement (Opus-class, top reasoning tier of your provider) |

## Step 0 — Triage & delegation (mandatory)

This skill is a **router**. The main conversation resolves what needs the user and owns every gate;
the reading, writing and checking go to subagents.

**Stays in the main conversation:**

- Identify the scenario (Step 1) and confirm it with the user when the input is ambiguous.
- Show the gate verdict (Step 2) and let the user override it either way.
- Confirm where the spec goes when the suite has no obvious home for it (Step 3).
- Show the reviewed diff and ask before creating a branch, committing or opening a merge request
  (Step 7).

**Delegated, one subagent per step, fresh context:**

| Step | Role | Tier |
|---|---|---|
| 2 — gate | read the run and the suite, score against the criteria | `deep` |
| 3–5 — author | study conventions, write the spec, prove it stable and able to fail | `deep` for a multi-step flow or new page objects; `balanced` for a single assertion with existing page objects |
| 6 — review | independent, read-only check of the spec | `deep`, never a fork of the author |

If a subagent comes back blocked, resolve it with the user and redispatch one tier up. Without
subagents, run the steps yourself and say in Step 7 that the review was **not independent**.

## Configuration (fill these in for your setup)

- **E2E suite** — the folder of committed specs (e.g. `tests/`, `e2e/`), its config, and how it is
  run in CI (project names, tags such as `@smoke` / `@regression`).
- **Conventions source** — page objects / action helpers folder, fixtures, test-data helpers, and
  the project's agent instructions (`AGENTS.md` / `CLAUDE.md`) — the author reads them before writing.
- **Scratch root** — where the manual runs live (default `_local/`).
- **Merge requests** — how the team opens them (`gh pr create`, `glab mr create`, a project skill).
  Only used after the user's explicit OK.

## Workflow

### 1. Identify the scenario and its run

Input is one of: a `manual-test` slug, a throwaway spec path, a ticket id, or a candidate from a
`scan-regression-candidates` report. **With no argument**, list the `PROMOTE` candidates of the most
recent scan report (or, without one, the reviewed runs in `_local/reports/`) and ask which one.
Collect:

- the throwaway spec(s) in `_local/scripts/` and the run's saved result (`_local/reports/<slug>.json`,
  which `manual-test` writes after its review — `reviewer_verdict`, `accepted_steps`,
  `confirmed_findings`, `reviewed_at` — or the report text when there is none);
- the independent reviewer's sign-off — which steps were accepted as `PASS`. Without one, the gate
  caps the candidate at `MAYBE`;
- the ticket's ACs (from the tracker, or from the report's brief) — **the source of expected values**;
- evidence and logs, for the author to understand the flow (never to copy expectations from).

If several scenarios match, list them and ask which one. If there is no accepted result for the
scenario (only `BLOCKED` / `INCONCLUSIVE` / `PO-DECISION`), stop: there is nothing verified to assert.

### 2. Gate — is it worth a permanent place?

Score the scenario with [`references/promotion-criteria.md`](references/promotion-criteria.md):
value, cost, disqualifiers — including a search of the committed suite for existing coverage of the
same route and outcome. Report `PROMOTE` / `MAYBE` / `SKIP` with the score and one line per
criterion.

- `SKIP` → stop and say why. The user may override; record that it was an override.
- `MAYBE` → say what would make it `PROMOTE` (a seeding helper, a fixture user, a stub) and ask.
- Existing partial coverage → propose **extending** that spec instead of adding a new one.

### 3. Study the suite before writing (author subagent)

Read, in this order: the project's agent instructions; the suite config; the page objects and
fixtures for the area; **two or three neighbouring specs** for the same feature. Write down the
conventions the new spec must follow — folder and file naming, test naming, tags, how auth and
data are set up, how base URLs are configured, which locator style the suite uses, how steps are
reported. If the suite has no home for this area, the author returns and the orchestrator asks the
user.

### 4. Write the spec (author subagent)

Rewrite — do not copy — the throwaway script:

| Throwaway script had | Regression spec has |
|---|---|
| Expected values taken from the screen, the recon, or the run | Expected values from the ACs / product rules, verbatim |
| Hard-coded staging URL | The suite's `baseURL` and route helpers |
| Raw locators, `getByText` guesses | The suite's page objects; add or extend one when the flow needs it |
| `console.log`, text dumps, network capture, evidence screenshots | Nothing — the reporter and trace on failure are enough |
| Login through the UI, or a personal `storageState` | The suite's auth fixture |
| Data a person created by hand on staging | Data created by the test (and cleaned up), or the suite's seed |
| Many observations per step | The few assertions that prove the outcome |
| `waitForTimeout`, `force: true`, `try/catch` around actions | Web-first assertions; none of the forbidden workarounds |

Two habits that keep the expected values honest:

- **Assert exactly what the AC states — no more.** If the AC says "the heading shows the counter
  (1)", assert the counter (`toContainText("(1)")`), not the whole heading as the screen showed it
  (`"Listings (1)"`): the extra words came from the screen, and a copy change would break a test that
  is about the counter.
- **Page objects hold locators, never expected values.** `getByRole("status")` belongs in the page
  object; `"Filters saved"` belongs in the spec's assertion. A locator filtered by the expected text
  turns a wrong-text regression into an unreadable "element not found".

Keep it to one user-meaningful outcome per test; fold variants into `test.step`s or a parameterised
loop (see *Folding, not adding* in the criteria). Tag it the way the suite tags regression tests. Add
the ticket id in a comment or annotation if the suite does that.

**Before writing, check the working tree.** Run `git status` and note the branch: if the files you
are about to touch (a page object, a fixture) already have uncommitted changes, or the branch is the
default branch, return and let the orchestrator ask the user (a new branch or a separate worktree is
the usual answer). Never mix the promotion into someone's unrelated edits.

**Write only inside the suite's folders** (spec, page objects, fixtures). No commits. Nothing under
the scratch root becomes part of the change.

### 5. Prove it (author subagent)

A spec is not done until it has shown both that it passes reliably and that it can fail:

Every run below goes to a **non-production** environment (staging or local) — check the base URL
the config resolves to before the first run; a spec that creates data is never repeated against
production.

1. **Stable:** run it in the suite's normal way (same config/project as CI, headless) with
   `--repeat-each=3` (or 5 for anything with async waits). All runs pass; any flake is fixed at the
   cause (a missing web-first assertion, shared state) — never with retries or longer timeouts.
2. **Able to fail:** break each key assertion on purpose — change the expected value to a wrong one,
   or point it at a sibling element — run once, confirm it **fails with a readable message**, then
   restore it and run once more green. A test that stays green when its assertion is wrong is not a
   test. Record each check (assertion, how it was broken, the failure message's first line).
3. **Static checks:** the project's lint / typecheck / format for the changed files.

Return: the files changed, the conventions followed, the stability and sensitivity results, and
anything left undone.

### 6. Independent review (reviewer subagent, read-only)

A fresh-context reviewer — never a fork of the author — gets the ACs, the gate verdict, the diff and
the author's proof, and checks:

- every expected value traces to an AC or a product rule, not to the manual run's screen — and no
  assertion is stricter than the AC (extra words copied from the page) or hidden in a page-object
  locator;
- the spec follows the suite's conventions (compare with the neighbouring specs it names);
- no forbidden workarounds, hard waits, hard-coded environments, personal data or secrets;
- flakiness risks the author missed (shared data, ordering, time zones, animations, third parties);
- the sensitivity checks actually exercised the key assertions;
- the scenario still deserves the gate verdict now that it is written (a spec that needed five new
  helpers may have turned into a `MAYBE`).

It returns: blocking issues, non-blocking suggestions, and a verdict (`approve` / `changes needed`).
On `changes needed`, the author fixes and the reviewer re-checks the fixed points.

### 7. Hand back to the user

Show: the gate score, the diff summary (files, lines), the proof (stability runs, sensitivity
checks, static checks), the review verdict, and what is left. Then **ask** before each of:
creating a branch, committing, pushing, opening the merge request. Use the team's merge-request
path and the project's commit conventions. Never push to the default branch.

## Rules

- **Few, strong tests.** The gate exists to say no. A promoted test that nobody needed costs more
  than a manual check that was never automated.
- **Expected values come from the ticket, never from the screen.** The manual run may have
  captured a bug as "how it looks".
- **No green test for an open bug.** Use the suite's own known-defect convention — and if it has
  none, or forbids them, don't add it yet.
- **Proven able to fail** before it is proposed.
- **The suite's conventions win** over the throwaway script's habits and over this file's examples.
- **No commits, pushes or merge requests without an explicit OK** in this conversation.
- **Never copy secrets, personal data or `storageState` contents** from the scratch root into the
  suite.
- **The scratch root stays untouched** — read it, never move or delete what is there.

## Errors

- **No accepted result for the scenario** → stop; suggest re-running it with `manual-test`.
- **Suite does not run locally** (missing env, auth fixture expired) → the author returns with what
  is missing; ask the user. Do not weaken the spec to make it run.
- **Spec flakes in Step 5** → fix the cause; if the cause is the environment, report it and stop.
- **Sensitivity check stays green** → the assertion is not reaching the behaviour; rewrite it.
