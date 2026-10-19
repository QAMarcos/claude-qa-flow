# Changelog

## 2.0.0 — 2026-10-19

Distilled from three months of daily use on a real product team.

### Architecture

- **Harness- and model-agnostic.** Skills follow the open Agent Skills format (standard frontmatter
  only) and use capability tiers (`fast` / `balanced` / `deep` / `deep+`) instead of vendor model
  names. Installable in Claude Code (plugin), OpenCode, Codex and any Agent Skills harness.
- **Skills moved to `skills/`.** Claude Code plugin + marketplace manifests in `.claude-plugin/`.
- **Router pattern (Step 0) in every skill.** The main conversation resolves everything that needs
  the user; the work is delegated to subagents, with a tier chosen per run and "redispatch one tier
  up" when a subagent comes back blocked.
- **Executor and reviewer roles** defined once in `skills/manual-test/roles/` and generated into
  Claude Code, OpenCode and Codex agent files by `scripts/build-agents.mjs` (`--check` for CI).
- **Harness-backed role boundaries (best effort):** read-only reviewer; no tracker writes or commits
  from either role — via a Claude Code PreToolUse hook (`scripts/guard-tracker-writes.mjs`, with
  regression cases in `scripts/test-guard.mjs` and an optional `QA_FLOW_GUARD_LOG` trace) or OpenCode
  `permission` rules (`deny`, never `ask`: a rejected `ask` kills the whole subagent in OpenCode).
- **`scripts/install.mjs`** — dependency-free installer per harness, never overwrites without `--force`.
- **Validated** in Claude Code 2.1.296 (plugin) and OpenCode 1.18.31: skills and subagents load, and
  the guards block tracker writes, commits and reviewer writes with on-disk ground truth. The Codex
  adapter is experimental and untested.

### `manual-test`

- Context: reads the ticket's linked branches/PRs (a merged PR without an observable AC is probably
  a pending deploy); lists known bugs before running; confirms what has no backend/data yet.
- Plan: every AC classified (in scope / blocked by dependency / blocked by account tier / PO
  decision); coverage sweep across alternative paths, state round-trips, breakpoints with filters
  applied, account tiers, and mobile as a separate component.
- Execution: six-section executor brief; short action/navigation/expect timeouts so a browser never
  hangs; network capture by blocklist, never allowlist.
- **Evidence discipline:** evidence must prove the claim; hash-based duplicate detection; element
  text dumps, not `body`; collapsed content proves nothing; re-open evidence before each `PASS`;
  a model that cannot view images says so and backs visual claims with DOM reads.
- Report: new statuses `BLOCKED-BY-DEPENDENCY`, `PO-DECISION`, `INCONCLUSIVE`; Findings and "Could
  not verify" sections; machine-checkable JSON summary.
- **New Step 6 — independent review**, mandatory before any write, plus a **severity gate** whose
  default is not to block the feature, and a product-intent check before filing.
- **Step 7 — filing:** one bug per root cause, mirrored fields, `relates to` links (never `blocks`),
  evidence referenced by filename, verification by GET; one index comment ≤ 800 characters of prose.
- Rules: throwaway files are **kept** until the user says the work is done (previously deleted at the
  end of each run); never move the ticket between columns; record learnings in project memory.

### `create-test-plan-scenarios`

- Step 0 router: a subagent drafts and self-reviews; posting stays with the user. Always `deep` tier.

### New: `file-bug-ticket`

- Tracker-agnostic bug filing: owner by layer, proportional priority/severity, placement rules,
  terse 4-section template with a 1000-character prose budget (500 for simple front-end bugs),
  attachments, JSON built with a serializer, verification by GET.

## 1.0.0 — 2026-07-03

- Initial release: `create-test-plan-scenarios` and `manual-test`.
