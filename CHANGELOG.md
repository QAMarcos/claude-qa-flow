# Changelog

## 2.1.0 — 2026-11-03

**Upgrading from 2.0:** re-run the installer with `--force` (or update the plugin). Without it you
keep the 2.0 `manual-test` and guard. A hook installed by hand needs the wider matcher the installer
prints.

### Added

- **Recon before scripting** (`manual-test`). The executor copies a template and records how the
  page is built (scoped aria snapshot, popups, test ids) without submitting or navigating. Recon
  says how to reach an element, never what to expect: a missing AC target is a `FAIL` candidate,
  never swapped for a look-alike.
- **Knowledge bank** (`.qa-flow/knowledge/`, optional). Small dated entries (gotchas, locators,
  product decisions, known bugs, test data) read before each run.
  - A product decision reaches only the reviewer, as "verify against <ticket>".
  - Updates are written only on their own explicit yes.
  - `check-knowledge.mjs` rejects secrets and emails, and flags stale entries.
- **`scan-regression-candidates`**: sweeps past runs and returns a short, scored list of flows worth
  a permanent test. It filters out probes and one-offs and redacts PII from what it reads.
- **`promote-to-regression`**: turns one reviewed run into a spec in your suite's conventions.
  - Promotes only on a value/cost gate.
  - Proves the spec stable and able to fail.
  - Gets an independent review and asks before any commit.
- `manual-test` saves each reviewed result to `_local/reports/<slug>.json` for the two skills
  above.

### Changed

- **No interaction workarounds:** no `force`, script or coordinate clicks, no removed overlays, no
  `try/catch` / `.or()` around an AC target.
- **`script_revisions`:** every change to the script is logged against a fixed list of allowed
  revisions, and the reviewer checks it.
- Specs use one `test()` per plan with `test.step` and `expect.soft`.
- Accessibility notes are Low by default.
- A bug is filed as blocking only when you say so.
- The guard hook also stops the executor from writing the knowledge bank and the reviewer from
  editing files. OpenCode gets equivalent deny rules.
- CI adds knowledge-checker (72), inventory (34) and recon-template sync checks; guard cases go from
  89 to 146.
- **OpenCode adapter** (validated in OpenCode 1.18.31): the executor's file-tool writes into the
  knowledge root are now denied by path, so the bank no longer relies on instructions alone there.
  Both subagents deny paths outside the project instead of OpenCode's default `ask` — a rejected
  `ask` ended the subagent whenever the model ran `cd sub && … ../`. Their prompts tell them to run
  commands from the project root. The Claude Code agents are unchanged.

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
  `permission` rules (`deny`, never `ask`: a rejected `ask` kills the whole subagent in OpenCode;
  OpenCode checks each command of a pipeline separately). The hook covers shell wrappers, quoted and
  absolute-path commands, `gh` / `glab` / `jira` writes and git history writes — 89 regression cases.
- **`scripts/install.mjs`** — dependency-free installer per harness, never overwrites without `--force`.
- **Validated** in Claude Code 2.1.296 (plugin) and OpenCode 1.18.31: skills and subagents load, and
  the guards block tracker writes, commits and reviewer writes with on-disk ground truth. The Codex
  adapter is experimental and untested.

### Docs

- README hero with a rendered flow diagram (replaces the ASCII art), status badges and quick links.
- `docs/assets/` holds the diagram and a social preview image (SVG source + PNG).
- `CONTRIBUTING.md` and a pull request template with the checks CI runs.
- `.gitattributes` pins LF line endings (authored on Windows, CI and hooks run on Linux).

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
