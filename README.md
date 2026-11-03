<h1 align="center">claude-qa-flow</h1>

<p align="center">
  <strong>From ticket to a verdict you can trust.</strong><br>
  A QA workflow for AI coding agents: a reviewed test plan, a real-browser run, an independent evidence review, and evidence-backed bug tickets.
</p>

<p align="center">
  <a href="https://github.com/QAMarcos/claude-qa-flow/actions/workflows/check.yml"><img alt="checks" src="https://img.shields.io/github/actions/workflow/status/QAMarcos/claude-qa-flow/check.yml?branch=main&label=checks&style=flat-square&labelColor=0B0D10&color=C6F45B"></a>
  <a href="CHANGELOG.md"><img alt="version" src="https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2FQAMarcos%2Fclaude-qa-flow%2Fmain%2F.claude-plugin%2Fplugin.json&query=%24.version&label=version&style=flat-square&labelColor=0B0D10&color=C6F45B"></a>
  <a href="LICENSE"><img alt="license" src="https://img.shields.io/github/license/QAMarcos/claude-qa-flow?style=flat-square&labelColor=0B0D10&color=C6F45B"></a>
  <a href="https://agentskills.io"><img alt="Agent Skills" src="https://img.shields.io/badge/Agent%20Skills-compatible-C6F45B?style=flat-square&labelColor=0B0D10"></a>
  <a href="#claude-code--plugin-recommended"><img alt="Claude Code plugin" src="https://img.shields.io/badge/Claude%20Code-plugin-C6F45B?style=flat-square&labelColor=0B0D10"></a>
  <a href="#opencode"><img alt="OpenCode" src="https://img.shields.io/badge/OpenCode-tested-C6F45B?style=flat-square&labelColor=0B0D10"></a>
</p>

<p align="center">
  <a href="#installation">Install</a> ·
  <a href="#usage">Usage</a> ·
  <a href="#why-it-works">How it works</a> ·
  <a href="#customizing-the-roles">Customize</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center">
  <img src="docs/assets/qa-flow-diagram.png" alt="qa-flow: ticket and test plan (create-test-plan-scenarios), then executor, trust boundary, independent read-only reviewer and severity gate (manual-test), then bug ticket (file-bug-ticket); human approval at the plan, the evidence and before publishing." width="100%">
</p>

- **Harness-agnostic** — built on the open [Agent Skills](https://agentskills.io) format. Tested in [Claude Code](https://claude.com/claude-code) and [OpenCode](https://opencode.ai); ships an experimental (untested) adapter for OpenAI Codex; the skills run in any harness that reads `SKILL.md`.
- **Model-agnostic** — the skills speak in capability tiers (`fast` / `balanced` / `deep`), not vendor model names. Map them to whatever your provider offers.
- **Tracker-agnostic** — Jira, Linear, GitHub Issues, Shortcut, … via their REST APIs.
- **Driven by [Playwright](https://playwright.dev/)** for execution, reusing your existing e2e project.

> **New in 2.1** — `manual-test` looks at the real page before scripting (read-only **recon**) and
> drops interaction workarounds like `force` clicks; an optional **knowledge bank** carries what past
> runs learned, without ever deciding a verdict; and two new skills, **`scan-regression-candidates`**
> and **`promote-to-regression`**, turn past manual runs into a few strong, proven regression tests.
> [Changelog](CHANGELOG.md) · [Upgrading from 2.0](#upgrading-from-20)

---

## The flow

1. **`create-test-plan-scenarios`** reads a ticket (description, ACs, comments, linked docs) and produces atomic, observable scenarios — including regression, edge cases and cross-surface side effects. It self-reviews the list and shows it to you before posting it back as sub-tasks.
2. **You review the plan.** The model can misread an ambiguous spec and then test it the way it understood it. This is where you catch that.
3. **`manual-test`** resolves context with you (environment, scope, known bugs, what has no backend yet, and what the project's **knowledge bank** already knows), then hands a six-section brief to an **executor** that first takes a short read-only **recon** of the real page, then drives a headed browser through a throwaway Playwright script and captures evidence. An **independent reviewer** — fresh context, read-only — opens the screenshots itself, overturns fragile `PASS` verdicts, and classifies every finding with a **severity gate** whose default is *don't block the feature*.
4. **`file-bug-ticket`** files one bug per root cause, inside a character budget, with the screenshots attached and everything verified by a GET — only after the review and your approval. Then `manual-test` proposes what the next run should not have to rediscover as a knowledge-bank update, written only on its own yes.
5. **`scan-regression-candidates`** sweeps the scratch root of past runs and returns a short, scored backlog of the scenarios worth a permanent regression test — filtering out probes, one-offs and flows the suite already covers. **`promote-to-regression`** turns one of them into a spec in your suite's conventions, proves it stable and able to fail, has it reviewed, and asks before any commit.

Each skill also runs on its own.

## Why it works

- **Roles, not one long prompt.** The executor, the reviewer and the tracker writer are separate roles with separate permissions. The reviewer never sees the executor's reasoning — only its claims and the evidence on disk — so it catches what the executor was anchored on.
- **Permissions backed by the harness, not just requested.** Where the harness supports it, the packaged agents are blocked from the common ways of breaking their role: the reviewer runs only read-only commands, and neither role can post to the tracker or commit (a Claude Code hook, or OpenCode's native `permission` rules). This is a **best-effort guard on the command line** — code that does its own HTTP (a `node -e "fetch(…)"`, a request inside the Playwright spec) is not caught — and neither are every shell wrapper or tracker CLI beyond `gh` / `glab` / `jira` — so the role instructions stay the primary control and the human gate before every external write stays mandatory.
- **Evidence discipline.** A `PASS` must cite a screenshot that shows the claimed state; duplicate screenshots (same hash) expose interactions that never happened; a timed-out click is `INCONCLUSIVE`, never "after".
- **Look before you script — but never copy the screen into the assertion.** A read-only recon (scoped aria snapshot, popups, test ids) tells the executor how to reach elements; expected values still come from the ACs, so a recon of a buggy page cannot turn the bug green. An AC target missing from the page is a `FAIL` candidate — never swapped for a look-alike — and every change to the script is logged for the reviewer.
- **No interaction workarounds.** No `force` clicks, script clicks, coordinate clicks or removed overlays: if a user could not click it, neither does the test.
- **A knowledge bank that informs, never decides.** Gotchas, locators that worked, known-bug pointers and product decisions live in small Markdown files with a source and a `last_verified` date, checked for secrets and staleness. The orchestrator routes each entry — a product decision goes to the reviewer as "verify against <ticket>", never to the executor — and every update waits for your explicit yes.
- **Honest statuses.** `BLOCKED-BY-DEPENDENCY`, `PO-DECISION` and `INCONCLUSIVE` keep "the backend isn't there yet" and "the AC is ambiguous" from being reported as failures.
- **Human in the loop for external writes.** Bug tickets and result comments from a QA run are posted only after the reviewer and your explicit OK; a test plan is posted after you approve the list (or automatically, if you explicitly enable auto mode for the session).
- **Throwaway, not tracked.** Scripts, evidence and logs live in a git-ignored `_local/` folder and are never committed — and never auto-deleted while you may still want to re-run them.

## What's inside

| Component | What it is | Portable? |
|---|---|---|
| `skills/create-test-plan-scenarios` | Ticket → reviewed QA checklist | Any Agent Skills harness |
| `skills/manual-test` | Orchestrates executor → reviewer → report → filing | Any Agent Skills harness |
| `skills/file-bug-ticket` | Terse, budgeted bug tickets with evidence | Any Agent Skills harness |
| `skills/scan-regression-candidates` | Scratch root of past runs → short, scored automation backlog | Any Agent Skills harness |
| `skills/promote-to-regression` | One reviewed manual run → a proven, reviewed regression spec | Any Agent Skills harness |
| `skills/manual-test/scripts/check-knowledge.mjs` | Knowledge-bank checker (fields, secrets, PII, staleness) | Node ≥ 18, no dependencies |
| `skills/manual-test/roles/*.md` | **Single source** of the executor and reviewer roles | Read directly by a generic subagent |
| `agents/` | Claude Code subagents (generated) | Claude Code |
| `adapters/opencode/agents/` | OpenCode subagents with `permission` rules (generated) | OpenCode |
| `adapters/codex/agents/` | Codex custom agents, TOML (generated) | Codex |
| `hooks/` + `scripts/guard-tracker-writes.mjs` | Blocks tracker writes, knowledge-bank writes and non-read commands for the two roles | Claude Code |

### How each harness runs it

| Harness | Skills | Executor / reviewer | Role boundaries enforced by |
|---|---|---|---|
| Claude Code (plugin) — tested | ✅ | ✅ packaged subagents | `tools:` allowlist + PreToolUse hook (best effort) |
| OpenCode — tested | ✅ | ✅ packaged subagents | native `permission` rules (best effort) |
| Codex — experimental, untested | ✅ | ✅ custom agents | instructions only (subagents inherit the parent sandbox) |
| Any other Agent Skills harness | ✅ | generic subagent reading `roles/*.md` | instructions only |
| No subagents at all | ✅ | roles played sequentially; review flagged as *not independent* | instructions only |

### Model tiers

The skills choose a tier per run — e.g. a one-assertion check gets `balanced`, a 6-scenario run with network correlation gets `deep+`, and the reviewer is always `deep`.

| Tier | Meaning | Claude | Other providers (examples) |
|---|---|---|---|
| `fast` | Mechanical, deterministic | Haiku | GPT mini-class, Gemini Flash-class |
| `balanced` | Follows a playbook well | Sonnet | GPT standard, Gemini Pro-class |
| `deep` | Judgement, open-ended reasoning, long runs | Opus | top reasoning tier of your provider |
| `deep+` | `deep` at the highest reasoning effort | Opus, max effort | top tier, highest effort |

**Plan with a stronger model, execute with a cheaper one** where the plan is simple — the skills already encode that.

## Requirements

- An AI coding harness that reads Agent Skills (see the table above).
- A Playwright e2e project to run `manual-test` from (Node.js + `@playwright/test`).
- Node.js ≥ 18 for the install/build scripts (no dependencies).
- A **vision-capable model** for the executor and reviewer — they must open the screenshots to judge the evidence.
- An issue tracker with a REST API for the fetch / post-back steps (optional — every skill also works from text you paste in).

## Installation

### Claude Code — plugin (recommended)

```
/plugin marketplace add QAMarcos/claude-qa-flow
/plugin install qa-flow@qa-flow
```


Skills, subagents and the guard hook are set up automatically. Skills appear namespaced: `/qa-flow:manual-test`.

### OpenCode

```bash
git clone https://github.com/QAMarcos/claude-qa-flow.git
cd claude-qa-flow
node scripts/install.mjs --target opencode
```

Copies the skills to `~/.config/opencode/skills/` and the subagents (with their `permission` rules) to `~/.config/opencode/agents/`. Use `--scope project` to install into the current project's `.opencode/` instead. Optionally pin a `deep`-tier model in the reviewer's `model:` line.

### Codex

```bash
node scripts/install.mjs --target codex
```

Skills → `~/.agents/skills/`, custom agents → `~/.codex/agents/`.

### Any other Agent Skills harness

```bash
node scripts/install.mjs --target agents
```

Copies the skills to `~/.agents/skills/` (the cross-harness location). If your harness uses another folder, copy `skills/*` there — each skill is self-contained, roles included, except that `scan-regression-candidates` reads `promote-to-regression`'s scoring criteria: copy those two together.

### Claude Code without the plugin

```bash
node scripts/install.mjs --target claude
```

Copies skills and subagents into `~/.claude/` and prints the `settings.json` snippet to enable the guard hook (the script never edits your settings).

All install targets skip folders that already exist unless you pass `--force`, and support `--dry-run`. `--force` overwrites files but does not delete files removed upstream.

### Upgrading from 2.0

Re-run the installer with `--force` (or update the plugin): without it the installer skips the existing
`manual-test`, agents and guard, and you keep a `manual-test` that neither runs recon nor saves the
reviewed results the two new skills read, plus a guard that does not protect the knowledge bank. With
the hook installed by hand (`--target claude`), also widen its matcher to the one the installer prints
(`Bash|PowerShell|Write|Edit|MultiEdit|NotebookEdit`).

### Upgrading from 1.x

1.x was installed by copying `create-test-plan-scenarios/` and `manual-test/` into `~/.claude/skills/` (or a project's `.claude/skills/`). Remove those two folders before installing 2.x — otherwise the installer skips them (old content stays), and with the plugin you get both `manual-test` and `qa-flow:manual-test`. OpenCode also reads `~/.claude/skills/`, so stale 1.x copies show up there too.

## Configuration

Each `SKILL.md` has a **Configuration** section with placeholders. Nothing is hard-coded to a company.

| Placeholder | What it is |
|---|---|
| `TRACKER_API_BASE` | Base URL of your tracker's REST API. |
| `TRACKER_TOKEN` | API token — **in env or a git-ignored `.env.local`, never in a skill file, never in git.** |
| `TRACKER_STORY_URL` | Human-facing URL pattern for a ticket. |
| App URLs | Staging / production (staging is the default; prod needs an explicit instruction). |
| Auth fixtures | Your stored `storageState`, e.g. `playwright/.auth/user.json`. |
| Scratch root | A **git-ignored** folder for throwaway work (default `_local/`). |
| Knowledge root | Optional curated knowledge bank (default `.qa-flow/knowledge/`) — commit it if your team wants it shared. |
| E2E suite | For `promote-to-regression` / `scan-regression-candidates`: where committed specs, page objects and fixtures live. |
| Owners / workspace ids | For `file-bug-ticket`: who owns front-end vs back-end bugs, default project, states. |

**Local hosts.** The Claude Code hook lets the executor send mutating requests to `localhost`, `127.0.0.1` and `*.test` / `*.localhost` (e.g. seeding a local app); the OpenCode rules deny every mutating `curl`, local or not — they are glob patterns checked per command and do not look at hosts, so they are also coarser than the hook in general. The same goes for the knowledge bank: OpenCode's rules stop shell writes into it, but its `edit` tool is not path-scoped, so file edits there rely on the role's instructions.

Behind bot protection / a WAF? The throwaway Playwright config has a spot for the `userAgent`/header your infra requires — sourced from env, never hard-coded.

> **Security:** never commit tokens or credentials. Keep them in a git-ignored `.env.local` and let the skills read them at runtime.

## Usage

Invoke by name, or just describe the task — each skill lists its trigger phrases.

```
/create-test-plan-scenarios TICKET-1234
/manual-test TICKET-1234
/manual-test Log in as a free-tier user, open Billing, and verify the "Upgrade" CTA is visible.
/file-bug-ticket The export button overlaps the table header at 1280px — screenshot in _local/evidence/export/
/scan-regression-candidates
/promote-to-regression TICKET-1234
```

(Claude Code plugin: prefix with `qa-flow:`. OpenCode / Codex: invoke the skill by name or describe the task.)

## Getting the best results

- **Review the plan before executing.** It is the cheapest place to catch a misread spec.
- **Tell `manual-test` what has no backend or data yet.** Those ACs become `BLOCKED-BY-DEPENDENCY` instead of false failures.
- **Let the reviewer run.** It is the step that most often changes the verdict — overturning a `PASS` backed by the wrong screenshot, or stopping a "bug" that is the product working as designed.
- **Respect the severity gate.** Rare triggers, fault-injection-only findings and "reload fixes it" become Low notes, not blockers. Promoting to blocking is your call.
- **Review the results too** before you post them or open a bug.
- **Promote few, strong flows to real specs.** Run `scan-regression-candidates` now and then; promote only what it scores as worth it, with `promote-to-regression`. A suite full of one-off checks is noise.
- **Keep the knowledge bank small and dated.** Approve entries that save the next run real time; prune what nobody has verified in months.

## Customizing the roles

The executor and reviewer are defined once, in `skills/manual-test/roles/`. The harness-specific agent files are generated from them:

```bash
node scripts/build-agents.mjs          # regenerate agents/ and adapters/
node scripts/build-agents.mjs --check  # CI: fail if generated files are stale
```

Edit the role (or a file in `skills/manual-test/references/` that a role includes), rebuild, commit both.

## Repository layout

```
claude-qa-flow/
├─ .claude-plugin/           plugin.json + marketplace.json (Claude Code)
├─ skills/
│  ├─ create-test-plan-scenarios/SKILL.md
│  ├─ manual-test/
│  │  ├─ SKILL.md
│  │  ├─ roles/              test-executor.md · evidence-reviewer.md   (single source)
│  │  ├─ assets/             recon.template.spec.ts   (copied by the executor; kept in sync with recon.md)
│  │  ├─ references/         recon · evidence discipline · severity gate · report format ·
│  │  │                      Playwright templates · filing & comments · knowledge bank
│  │  └─ scripts/            check-knowledge.mjs
│  ├─ file-bug-ticket/SKILL.md
│  ├─ scan-regression-candidates/   SKILL.md · scripts/inventory.mjs
│  └─ promote-to-regression/        SKILL.md · references/promotion-criteria.md
├─ agents/                   Claude Code subagents        (generated)
├─ adapters/
│  ├─ opencode/agents/       OpenCode subagents           (generated)
│  └─ codex/agents/          Codex custom agents          (generated)
├─ hooks/hooks.json          Claude Code guard hook
├─ scripts/                  build-agents · guard-tracker-writes · install · test-guard · test-knowledge ·
│                            test-inventory · check-recon-template
├─ .github/                  CI (generated files, guard / knowledge-checker / inventory cases, recon template sync,
│                            skill names) · PR template
├─ docs/assets/              README diagram and social preview (SVG source + rendered PNG)
├─ CONTRIBUTING.md
├─ CHANGELOG.md
├─ README.md
└─ LICENSE
```

## License

MIT — see [LICENSE](./LICENSE).
