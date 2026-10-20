# Contributing

Thanks for helping improve qa-flow. A few things in this repo are not obvious from the file tree.

## Keep it generic

These skills are meant for any team. Do not add company names, internal URLs, ticket ids, team
members, credentials or domain-specific examples. Tracker and app details stay as placeholders
(`TRACKER_API_BASE`, `staging.<your-app>.example.com`, …). Never commit tokens or `.env` files.

## Where things live

- `skills/` — the portable Agent Skills. Only standard frontmatter (`name`, `description`,
  `license`, `compatibility`, `metadata`); `name` must match the folder.
- `skills/manual-test/roles/` — **single source** of the executor and reviewer roles.
- `agents/`, `adapters/opencode/agents/`, `adapters/codex/agents/` — **generated**. Do not edit
  them by hand.
- `scripts/guard-tracker-writes.mjs` — the Claude Code guard hook; `scripts/test-guard.mjs` holds
  its regression cases.
- `docs/assets/` — README diagram and social preview: edit the `.svg`, then re-render the `.png`
  with Chromium at 2x (e.g. Playwright `page.screenshot` with `deviceScaleFactor: 2` at the SVG's
  own size). The SVGs use Bahnschrift and Cascadia Mono (bundled with Windows); on other systems the
  fallback fonts change the metrics, so check the result for clipped text before committing.

## Before opening a PR

```bash
node scripts/build-agents.mjs          # after editing a role or a reference a role includes
node scripts/build-agents.mjs --check  # generated files are up to date
node scripts/test-guard.mjs            # guard regression cases
claude plugin validate .               # if you have Claude Code installed
```

- Changing the guard? Add a case to `scripts/test-guard.mjs` for every new allow or deny — both the
  command you meant to block and a legitimate one that must keep passing.
- Changing OpenCode permissions (`scripts/build-agents.mjs`)? OpenCode checks each command of a
  pipeline separately and the last matching rule wins; use `deny`, never `ask`, for subagents.
- Changing what the skills claim? Keep README, CHANGELOG and the SKILL.md files consistent, and do
  not claim a harness or behaviour you have not tested.

CI runs the generated-files check, the guard cases and the skill-name check on every push and PR.
