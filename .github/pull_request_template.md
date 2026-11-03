## What and why

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] `node scripts/build-agents.mjs --check` passes (rebuilt after editing a role or included reference)
- [ ] `node scripts/test-guard.mjs` passes (new cases added if the guard changed)
- [ ] `node scripts/test-knowledge.mjs` passes (new cases added if the checker changed)
- [ ] `node scripts/check-recon-template.mjs` passes (edit `assets/recon.template.spec.ts`, then `--fix`)
- [ ] `node scripts/test-inventory.mjs` passes (new cases added if the inventory changed)
- [ ] No company names, internal URLs, ticket ids or credentials
- [ ] README / CHANGELOG / SKILL.md stay consistent with the change
- [ ] Tested in: <!-- Claude Code / OpenCode / Codex / other — and how -->
