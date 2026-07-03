# claude-qa-flow

Two [Claude Code](https://claude.com/claude-code) skills that turn a ticket into a reviewed QA test plan and then execute it against your running web app — with real-browser evidence and a pass/fail report.

Tracker-agnostic (Jira, Linear, GitHub Issues, Shortcut, …) and driven by [Playwright](https://playwright.dev/) for execution.

---

## The flow

```
  ┌─────────────────────────────┐        ┌──────────────────────────┐
  │ create-test-plan-scenarios  │        │        manual-test        │
  │                             │        │                           │
  │  ticket  ──▶  QA checklist  │  ────▶  │  checklist ──▶ real       │
  │  (spec + comments + links)  │ you     │  browser run ──▶ evidence │
  │                             │ review  │  ──▶ PASS/FAIL report      │
  └─────────────────────────────┘        └──────────────────────────┘
        "what to test"                          "actually test it"
```

1. **`create-test-plan-scenarios`** reads a ticket (description, acceptance criteria, comments, linked docs) and produces a structured checklist of atomic, observable scenarios — including regression, edge cases, and cross-surface side effects. It self-reviews the list, shows it to you, and can post it back to your tracker as sub-tasks.
2. **You review the plan** — this is the important human step. Fix anything ambiguous before execution.
3. **`manual-test`** takes that plan (or a single ad-hoc scenario) and executes it against the app in a real headed browser via a throwaway Playwright script, captures screenshots as evidence, and reports pass/fail per step. It never commits the throwaway script.

The two skills are independent — you can run either on its own — but they're designed to hand off to each other.

## Why it works

- **Reuses your existing e2e project.** `manual-test` runs from your Playwright repo, so it reuses your stored auth (`storageState`), page objects, and fixtures instead of rebuilding them.
- **Throwaway, not tracked.** Generated scripts live in a git-ignored scratch folder, so exploratory runs never pollute your committed e2e suite. (Bonus: keep the reusable ones locally and Claude reuses the flow for future validations of the same pages.)
- **Faithful execution.** Uses the exact copy/IDs/URLs from the spec, and when a step reveals a real bug it reports it — it does **not** add retries or `try/catch` to make a red step look green.
- **Follows Playwright best practices.** Role-based locators, web-first (auto-retrying) assertions, no hard waits, `storageState` reuse.

## Requirements

- [Claude Code](https://claude.com/claude-code) (CLI, desktop, or IDE extension).
- A Playwright end-to-end project you can run `manual-test` from (Node.js + `@playwright/test` installed).
- An issue tracker with a REST API if you want the "fetch ticket" / "post checklist back" steps (optional — both skills also work from a scenario you paste in directly).

## Installation (via Claude Code)

Claude Code loads **personal skills** from `~/.claude/skills/<skill-name>/SKILL.md` (on Windows: `C:\Users\<you>\.claude\skills\`). To install:

```bash
# 1. Clone the repo
git clone https://github.com/QAMarcos/claude-qa-flow.git
cd claude-qa-flow

# 2. Copy both skill folders into your personal skills directory
#    macOS / Linux:
cp -R create-test-plan-scenarios manual-test ~/.claude/skills/

#    Windows (PowerShell):
Copy-Item -Recurse create-test-plan-scenarios,manual-test $env:USERPROFILE\.claude\skills\
```

Prefer them **project-scoped** instead (so they ship with one repo and everyone on the team gets them)? Copy the two folders into that repo's `.claude/skills/` instead of `~/.claude/skills/`.

Verify: start Claude Code and type `/` — you should see `create-test-plan-scenarios` and `manual-test` in the skill list.

## Configuration

Each `SKILL.md` has a **Configuration** section with placeholders to fill in for your setup. Nothing is hard-coded to a specific company. Set:

| Placeholder | What it is |
|---|---|
| `TRACKER_API_BASE` | Base URL of your issue tracker's REST API. |
| `TRACKER_TOKEN` | API token — **store it in a local `.env.local` / secrets file or env var, never in the skill file, never in git.** |
| `TRACKER_STORY_URL` | Human-facing URL pattern for a ticket. |
| App URLs | Your staging / production URLs (staging is the default; prod requires an explicit instruction). |
| Auth fixtures | Path to your project's stored `storageState` (e.g. `playwright/fixtures/loginAuth.json`). |
| Scratch folder | A **git-ignored** folder for throwaway scripts (e.g. `playwright/manual/`). |

If your app sits behind bot-protection / a WAF / a CDN challenge, `manual-test` has a spot in the throwaway config to add the `userAgent`/header your infra requires — again sourced from env, never hard-coded.

> **Security:** never commit tokens or credentials. Keep them in a git-ignored `.env.local` and let the skills read them at runtime.

## Usage

Invoke either skill by name in Claude Code. Natural language works too (both skills list their trigger phrases).

**1. Create the plan:**

```
/create-test-plan-scenarios TICKET-1234
```

Claude fetches the ticket, drafts scenarios, runs a self-review pass, and shows you the list. Approve or edit, then let it post back to the tracker (it asks once before writing).

**2. Execute it:**

```
/manual-test TICKET-1234
```

Claude derives the executable plan from the ticket's checklist, spins up a headed browser, runs each step, screenshots evidence into your `evidence/` folder, and prints a per-step PASS/FAIL report. It can optionally post the results (with embedded screenshots) back to the ticket.

**Ad-hoc, no ticket:**

```
/manual-test Log in as a free-tier user, open Billing, and verify the "Upgrade" CTA is visible.
```

## Getting the best results

- **Always review the generated plan before executing.** The model can misread an ambiguous spec and then "test it the way it understood it" — which isn't what you meant. The review step is where you catch that.
- **Plan with a stronger model, execute with a cheaper one.** Building the test plan benefits from the most capable model; executing predefined steps does not. Use your top model for `create-test-plan-scenarios` and a cheaper/faster one for `manual-test` to cut token cost.
- **Review the results too.** Confirm the evidence actually shows what the report claims before you post it or open a bug.
- **Keep scratch scripts out of git.** The throwaway specs are disposable; the skills write them to a git-ignored folder on purpose. Keep the genuinely reusable ones locally so Claude can reuse the flow next time.
- **Promote proven flows to real specs.** When a scenario proves valuable and gets re-run often, migrate it into your committed Playwright suite — following your project's own architecture and patterns.

## Repository layout

```
claude-qa-flow/
├─ create-test-plan-scenarios/
│  └─ SKILL.md
├─ manual-test/
│  └─ SKILL.md
├─ README.md
└─ LICENSE
```

## License

MIT — see [LICENSE](./LICENSE).
