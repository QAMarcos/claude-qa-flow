---
name: manual-test
description: Execute exploratory/manual QA against a web app, driven by either a ticket's test plan or a single ad-hoc scenario the user describes. Use whenever the user asks to "run a manual test", "fazer um teste manual", "execute this scenario", "validate this ticket manually", "manual test for TICKET-XXXX", or otherwise wants the agent to step through a behavior in the real app and report pass/fail with evidence. Resolves context with the user, delegates execution to an executor subagent, has the evidence checked by an independent reviewer, and only then (with approval) writes back to the tracker.
license: MIT
compatibility: Any Agent Skills harness (Claude Code, OpenCode, Codex, ...). Needs shell access, Node.js and @playwright/test in the project under test. Subagents recommended; executor and reviewer need a vision-capable model.
metadata:
  version: "2.0.0"
  routing: router
---

# Manual Test

Drives manual / exploratory QA against a web app. Reads the test context (from an issue-tracker
ticket or directly from the user), executes it by piloting a real browser through a throwaway
Playwright script, has the evidence independently reviewed, and reports pass/fail. **Does not commit
any test files** — every script written here is throwaway and lives in a git-ignored scratch root.

> Pairs with `create-test-plan-scenarios` (produces the checklist) and `file-bug-ticket` (files the
> bugs this run finds).

## Model tiers used below

Tiers are capability levels, not vendor names — map them to what your harness offers:

| Tier | Meaning | Examples (as of writing) |
|---|---|---|
| `fast` | Cheap, deterministic, mechanical | Haiku-class, GPT mini-class, Gemini Flash-class |
| `balanced` | Follows a documented playbook well | Sonnet-class, GPT standard, Gemini Pro-class |
| `deep` | Open-ended reasoning, judgement, long runs | Opus-class, GPT top reasoning tier, Gemini top tier |

`deep+` means the top tier **and** the highest reasoning effort the harness exposes.

## Step 0 — Triage & delegation (mandatory)

This skill is a **router**: it does not execute the test in the main conversation. A browser run
produces a lot of tool output (browser, network, console) that should not fill the conversation, and
the review only works if the reviewer did not watch the run.

**Stays in the main conversation (orchestrator):**

- Decide the mode, load the ticket, derive the plan (Steps 1–2).
- Ask the user for anything you cannot access (external docs, designs, pasted content).
- Confirm the environment. Default is **staging**; production only with an explicit instruction in this turn.
- Confirm how to seed any state the standard fixture cannot reach.
- List the **known bugs** that cross the plan, so the executor does not re-investigate them.
- After the executor returns: dispatch the **independent reviewer** (Step 6) and, only with the
  user's approval, the tracker writes (Step 7).

**Three distinct roles, in this order:** executor (Steps 3–5) → reviewer (Step 6) → tracker writer
(Step 7, via `file-bug-ticket`). The reviewer is **never** a fork of the executor or of this
conversation: it must reach the evidence without inheriting the conclusions of whoever produced it.
Pass context through the prompt, not through inheritance.

### How to dispatch, in any harness

Use the first option your harness supports:

1. **Packaged agents** — if `qa-test-executor` and `qa-evidence-reviewer` are installed (Claude Code
   plugin, or the OpenCode/Codex adapters in this repo), dispatch them by name (the plugin namespaces
   them, e.g. `qa-flow:qa-test-executor`). They carry the role prompt with its references inlined, so
   do not point them at `roles/` — they spend the first turns searching for it. In Claude Code and
   OpenCode they also get a best-effort permission guard (reviewer read-only; no tracker writes or
   commits); in Codex the boundary is instruction-only.
2. **Generic subagent** — spawn a fresh-context subagent and make its first instruction: "Read
   `<absolute path>/roles/test-executor.md` (or `roles/evidence-reviewer.md`) and follow it" —
   resolve the path next to this SKILL.md yourself; the subagent does not know where it is.
   Repeat the "never write to the tracker" rule in the brief, since nothing enforces it.
3. **No subagents at all** — play the roles yourself, sequentially. For the review, start a clean
   pass: re-open the evidence from disk, ignore your earlier conclusions, and state in the report that
   the review was **not independent**.

### The executor brief

A thin prompt ("run these scenarios") is what produces a fragile report. Carry all six sections:

```
[Generic subagent only: Read <absolute path>/roles/test-executor.md and follow it.]
Environment: <staging|prod>. User/fixture: <which>.

## Ticket and ACs
<ACs verbatim — do not paraphrase; the executor compares this text with the screen>

## Scope
In scope: <...>. Out of scope: <...> — and WHY (e.g. data for X does not exist yet).
If something out of scope fails, record it as an observation, not a ticket failure.

## Plan (already resolved — run in this order, do not re-derive)
<numbered list, with what to observe in each item>

## Known bugs — do NOT investigate, do NOT file
<ID: one-line repro> → if crossed, label BLOCKED and move on.

## App/environment gotchas
<bot protection, overlays to dismiss, URL-based seeding, selectors,
 baseline console noise, short timeouts, network capture by blocklist>

## Rules
Throwaway files in _local/. Do not commit. Do not write to the tracker.
Evidence must prove what it claims — a failed click is not a new state.
Do not ask anything; if stuck, return what blocked you, what passed, and the evidence collected.
```

### Tiers per role

| Role | Situation | Tier |
|---|---|---|
| Executor | 1 short scenario, a single visual/text assertion | `balanced` |
| Executor | 2–5 scenarios on the UI happy path | `deep` |
| Executor | ≥6 scenarios, or console/network correlation, or multi-user/multi-tab, or a payment flow | `deep+` |
| **Reviewer** | Always — judging coverage and overturning fragile conclusions | `deep` |
| **Tracker writer** | Fields and body already resolved by the orchestrator; it only posts and verifies | `balanced` |

A second pass after the review inherits the executor's tier, never less — it attacks exactly what
was hard the first time. If a subagent comes back blocked, resolve it with the user and **redispatch
one tier up** instead of taking the work over in the main conversation.

**Do not delegate guided mode** (the user performs the steps and reports what they saw) — that is a
conversation and runs inline. If the executor discovers mid-run that guided mode is needed, it
returns and the orchestrator takes over.

## Two modes

- **Ticket mode** — the user passes a ticket id (`TICKET-1234`, a bare number, or a full URL). Load
  the ticket, derive the plan from the description / ACs / existing checklist, run each item in order.
- **Ad-hoc mode** — the user pastes a single scenario in plain language. Execute that one scenario
  only, no ticket lookup.

If the user gives both, ad-hoc wins; ask whether to still pull the ticket for context.

## Configuration (fill these in for your setup)

- **App under test** — staging and production URLs. Default to **staging**; never hit production
  without an explicit instruction in this turn.
- **E2E repo** — run from your Playwright project so fixtures and page objects are reusable.
- **Auth fixtures** — your stored `storageState` file(s), e.g. `playwright/.auth/user.json`.
- **Page-object helpers** — prefer them over raw selectors when one already covers the flow.
- **Scratch root** — one git-ignored folder for everything throwaway (default `_local/`, with
  `scripts/`, `evidence/<slug>/`, `logs/`). Never inside the committed suite or the repo root.
- **Tracker** — `TRACKER_API_BASE` and `TRACKER_TOKEN`, read at runtime from env or a git-ignored
  `.env.local`. Never inline, never commit, never print.

## Auth & secrets

- **Tracker token:** from env / local secrets file. On `401`, ask the user for a fresh token, update
  the local file, retry once.
- **App credentials:** in a git-ignored `.env`; your global/auth setup generates the `storageState`
  fixtures. If a fixture is missing or older than the session lifetime, regenerate it or ask the user.
- **Bot protection / WAF:** if your app sits behind one, the automated session may need a specific
  `userAgent` or header — configure it in the throwaway config, sourced from env. A silent challenge
  page looks like "login failed" but isn't.

## Workflow

### 1. Resolve mode & gather context

**Ticket mode:**

1. Normalize the id and fetch the ticket via the tracker API.
2. Pull: title, description, type, custom fields, comments, related-ticket links, existing checklist,
   **and the linked branches / pull requests**.
   - PRs say what was actually delivered. A follow-up PR named `fix: …` points straight at what
     needs extra verification — e.g. a `fix: stack mobile search toggle` PR turns "test on mobile"
     into a mandatory scenario.
   - PR merged but the AC is not observable in the app → probably a pending deploy. Confirm before failing it.
3. For each link in description / comments (docs, designs, wikis), try to fetch it. If it needs auth
   or returns junk, **ask the user to paste the relevant content** — be specific about what you need
   — and wait. Never invent expectations to fill the gap.
4. Read every comment — product owners clarify copy, IDs and edge cases there. Comments override the description.
5. **List the known bugs that cross this ticket, BEFORE running.** A run that rediscovers a tracked
   bug wastes the turn and pollutes the report with a false-new finding. Look at:
   - the ticket's links (what already `blocks` it);
   - sibling bugs in the same epic/project;
   - a tracker text search for the feature name restricted to bugs;
   - your project notes / persistent memory — environment bugs usually live there.

   For each, write into the plan: "if crossed, label `BLOCKED — <id> known`, do not investigate, do not file".
6. **Confirm with the user/PO what has no data or backend yet.** Front-end delivered before its
   backend is common and changes the reading of half the ACs — those become `BLOCKED-BY-DEPENDENCY`,
   not `FAIL`. Ask before running, not after failing.

**Ad-hoc mode:** take the scenario verbatim. If it references external context ("as in ticket X",
"like in design Y"), follow the same fetch-or-ask loop.

### 2. Draft an executable plan

Numbered **atomic, observable steps**, each with a **precondition** (which user, which screen), an
**action** (one interaction) and an **expected result** (verbatim copy from the spec when given). If
the ticket already has a QA checklist, use it as the source of truth — don't re-derive.

**Classify each AC before running**, and write the class into the plan:

| Class | When | Becomes |
|---|---|---|
| **In scope** | Verifiable today with the data and account we have | `PASS` / `FAIL` |
| **Blocked by dependency** | Depends on backend/data that does not exist yet (sibling ticket) | `BLOCKED-BY-DEPENDENCY` — never `FAIL` |
| **Blocked by account tier** | Needs a plan/role we do not have | `BLOCKED` + say which account would unblock it |
| **PO decision** | The AC contradicts an epic business rule, or is silent on the case | `PO-DECISION` — a question, not a bug |

**Coverage — sweep the axes, not just the happy path.** A first pass tends to exercise one path per
AC and declare `PASS`; that is how layout and state bugs slip through. Before closing the plan, ask:

- **Alternative paths to the same AC.** "Clicking X **or** Y" → test both. Two entry points to the
  same state → test both; the same click can work from one context and be swallowed from the other.
- **State, not just render.** Round-trip with filters **filled in** (not on an empty screen),
  refresh, browser Back/Forward, deep link, and what persists server-side.
- **Breakpoints, when the change touches layout** — mandatory when the ticket has a layout PR.
  Measure at ≥4 widths (e.g. 1600 / 1440 / 1280 / 1024 / mobile) **and with a filter applied** — a
  counter like "(1)" changes the bar's geometry. One viewport hides the bug.
- **Account tiers and gating.** If a list has gated and free items, exercise at least one of each.
  "Tested 2 of 7 types, both free" does not cover an AC that says "**any**".
- **Mobile is another component, not the same one narrower.** A control in the desktop bar may
  become a sheet on mobile — re-verify the AC inside it, not just the stacking.

**Frame the scope with the user when the ticket is front-end without backend.** Say what stays out
and why, before running.

Show the plan before executing **only when**: the ticket is ambiguous and you made non-trivial
assumptions; the plan exceeds ~10 steps; or the test is destructive (delete, payment, sending email).
Otherwise proceed — the user invoked this skill to see the run, not to re-approve it.

### 3–5. Execute and report (executor role)

Dispatch the executor (Step 0) with the six-section brief. Its procedure is in
[`roles/test-executor.md`](roles/test-executor.md); the templates it uses are in
[`references/playwright-templates.md`](references/playwright-templates.md), its evidence rules in
[`references/evidence-discipline.md`](references/evidence-discipline.md), and the report it returns
in [`references/report-format.md`](references/report-format.md).

When it returns, check the machine-checkable JSON block first: every `PASS` cites evidence, no
duplicate screenshots back different steps, every finding has a severity proposal.

**Fallbacks:**

- **No Playwright path possible** (mobile-only flow, third-party iframe blocking automation, payment
  sandbox): **guided mode**, inline — print the steps one by one, ask the user to perform each, wait
  for their observation, compare, record. Save their screenshots to the evidence folder.
- **A state you cannot reach with the standard fixture** (account flag, paid plan, seeded data):
  pause and ask the user how to seed it. Don't fabricate one.

### 6. Independent review (mandatory before any write)

**Nothing goes to the tracker without passing a reviewer.** Dispatch it per Step 0 (fresh context,
never a fork). Its procedure is in [`roles/evidence-reviewer.md`](roles/evidence-reviewer.md).

Its prompt carries, in writing: the ACs verbatim; the agreed scope and why; the known bugs that do
not count as findings; what was executed and the result item by item; the findings with their
proposed classification; and **the paths to the evidence, logs and scripts** — the reviewer must be
able to open the screenshots and read the scripts, not just trust the report. It returns four
sections: missing scenarios, fragile conclusions, findings to promote/demote (with severity), and
sign-off.

**After the review, the orchestrator decides:** run a second pass on the gaps, or move to filing.
Take the decision to the user when the second pass costs real time — and **say whether any possible
outcome of it could block the ticket**. A pass that only hunts failure paths, fault injection or rare
timing is **informational**: the ticket moves on with whatever it finds.

Every finding carries `blocking` or `non-blocking (Low)` per the
[severity gate](references/severity-gate.md). **The default is not to block**, and promoting a
finding to blocking is the user's call. Before accepting any finding — the executor's or the
reviewer's — check it against product intent (same file).

### 7. Follow-ups: comment on the ticket and file the bugs

Only after Step 6, and with the user's approval. All in English. Full rules in
[`references/filing-and-comments.md`](references/filing-and-comments.md):

- One bug = one root cause; mirror a sibling bug's fields; link with `relates to`, never `blocks`;
  evidence attached and referenced by filename; verify everything with a GET.
- File bugs through the `file-bug-ticket` skill with fields **already resolved** and the body
  **already written by you, in a file**.
- One index comment on the parent, **≤ 800 characters of prose**, with evidence embedded when it is
  the only artifact.
- Mark checklist items complete only for clean passes, after asking once.
- Do not move the ticket between columns — suggest; the user decides.
- Record what the next session would have to rediscover in your project notes / memory.

## Rules

- **Faithful execution.** Exact URLs, copy, IDs and account types from the ticket/spec. If something
  is missing, ask — do not improvise.
- **No workarounds for app bugs.** A real bug fails the test. No retries or `try/catch` to turn a red
  step green.
- **Never commit the throwaway script.** The scratch root is the only place it may exist.
- **Do not delete anything until the user says the work is finished.** Keep scripts, configs, logs
  and evidence for the whole session — the user may re-run, iterate or inspect. Never auto-clean.
- **Staging by default.** Production needs an explicit "run on prod" in this turn.
- **One scenario at a time in ad-hoc mode.** If the user pastes several, ask which first.
- **All shared artifacts in English**; conversation may stay in the user's language.
- **Be explicit when you cannot access something.** "I couldn't open design X — please send a
  screenshot of component Y" beats a guess.
- **Text budget for the tracker:** comment ≤ 800 characters of prose; bug body per `file-bug-ticket`
  (1000, or 500 for a simple front-end bug). Count before posting; if a real reason needs more, ask.
- **Nothing reaches the tracker without the Step 6 review.** The cost of a wrong finding there is
  credibility with the team.
- **Evidence must prove the claim.** In doubt, `INCONCLUSIVE`.
- **Before filing a bug, look for the sentence that says it is the product working.**
- **A known bug is not a finding.** Label, reload, move on.
- **Never leave a browser window hanging.** Short action timeouts; close the context if a run dies.
- **A narrow finding does not block a feature** — apply the severity gate.
- **Evidence always ships with the result.** A results comment without its screenshots is incomplete.

## Errors

- **Tracker 401** → token rotated. Ask the user, update the local secrets file, retry once.
- **Tracker 404** → wrong id. Print the id used and stop.
- **Playwright login failure** (`storageState` expired) → regenerate the auth fixture or ask the user
  to refresh credentials. Behind bot protection? Confirm the `userAgent`/header is configured.
- **Selector not found / not visible** within the action timeout → a test finding, not a tooling
  error. Report it as the step's observation.
- **External link unfetchable** → ask the user for the content. Don't proceed on guesses.

## Notes

- Read-heavy on the tracker API, write-light. Writes happen only after review and explicit confirmation.
- If the same scenario will be re-run often, suggest promoting it to a committed spec in your suite —
  as a suggestion only.
