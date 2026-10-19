---
name: create-test-plan-scenarios
description: Turn a task/ticket into a structured, professional QA test plan — a checklist of atomic, executable scenarios — and (optionally) post it back to your issue tracker. Use whenever the user asks to "create a test plan", "list test scenarios", "criar cenários de teste", "QA checklist for TICKET-XXXX", or otherwise wants a ticket turned into a verifiable QA plan. Works for any story type (UI, API, mobile, infra). Always runs a self-review pass before writing anything back.
license: MIT
compatibility: Any Agent Skills harness (Claude Code, OpenCode, Codex, ...). Tracker write-back needs shell access with curl (or equivalent) and an API token. Subagents recommended.
metadata:
  version: "2.0.0"
  routing: router
---

# Create Test Plan Scenarios

Turns any task/ticket into a structured, professional QA test plan: a checklist of atomic, observable, independently-runnable scenarios. Optionally posts the checklist back to your issue tracker as native sub-tasks. Works for UI, API, mobile, and infra stories. Always runs a self-review pass before writing anything.

> These scenarios are the source of truth consumed by the `manual-test` skill, which executes them against the running app. Keep each one atomic and observable so it maps cleanly to an executable step.

## Step 0 — Triage & delegation (mandatory)

This skill is a **router**: generation and self-review go to a subagent; the posting gate stays with
the user in the main conversation.

**Delegated (subagent, fresh context):** read the ticket, draft the checklist, and run the
self-review — Steps 1–5. The subagent **returns the checklist; it does not post.** Suggested brief:

```
Read the create-test-plan-scenarios SKILL.md and run it through Step 5 (self-review) inclusive.
Do NOT post to the tracker. Ticket: <ID>. Focus hints: <any>.
Return the final checklist and the [CONFIRM: …] flags still open.
```

If your harness has no subagents, run Steps 1–5 inline.

**Stays inline (main conversation):** show the checklist, run Step 6 (confirm posting) and then post
(Step 7) — an external write, and a cheap API call. Two cases are resolved **before** delegating:

- Ticket closed/archived → require explicit confirmation, even in auto mode.
- Empty description → do not delegate; ask the user for one sentence of context first.

**Tier** (capability levels — map to your harness: `balanced` ≈ Sonnet-class, `deep` ≈ Opus-class /
top reasoning tier; `deep+` = top tier at the highest reasoning effort):

| Situation | Tier |
|---|---|
| Well-written ACs, scope of one screen/endpoint | `deep` |
| Vague ticket, multi-system (web + mobile + API), or business rules to infer | `deep+` |

This skill is `deep` by nature: the checklist is the source of truth `manual-test` executes. Do not
downgrade it to `balanced` — plan with the strongest model, execute with a cheaper one.

## Configuration (fill these in for your setup)

This skill is tracker-agnostic. Connect it to whatever issue tracker you use (Jira, Linear, GitHub Issues, Shortcut, …) by setting:

- **`TRACKER_API_BASE`** — base URL of your tracker's REST API (e.g. `https://your-tracker.example.com/api/v3`).
- **`TRACKER_TOKEN`** — an API token. **Never hard-code it in this file.** Store it in a local secrets file or environment variable outside version control (e.g. `.env.local`, a local credentials file), and read it at runtime. Rotate it if it ever leaks.
- **`TRACKER_STORY_URL`** — the human-facing URL pattern for a ticket (e.g. `https://your-tracker.example.com/story/<ID>`).

If your tracker has no API (or you don't want write access), skip the "post back" steps and just output the checklist for the user to paste in manually.

## Inputs

The user provides the ticket id, in any of these forms:
- a bare id: `1234`
- a prefixed id: `TICKET-1234`
- a full URL: `https://your-tracker.example.com/story/1234/anything-after`

Normalize to the id your API expects before calling it.

The user may also pass extra focus hints (e.g. "skip a11y", "focus on regression", "no modal scenarios"). Honor them when generating.

## Workflow

### 1. Fetch the ticket

Call your tracker's API to load the ticket. Read the token from your secrets file/env — never inline it.

```bash
curl -s -H "Authorization: Bearer $TRACKER_TOKEN" "$TRACKER_API_BASE/stories/<ID>"
```

Pull the equivalent of: `title/name`, `description`, `type`, custom fields, `comments`, links to related tickets, and any existing checklist/sub-tasks.

### 2. Enrich context (best-effort)

- For each linked ticket, fetch it one level deep to understand siblings/blockers — don't recurse.
- For markdown links in the description and comments (Google Docs, Figma, internal wikis): try your harness's web-fetch tool. If it requires auth or fails, list it as `context not loaded — open manually` and proceed.
- Read all comments — product owners and QA often clarify the spec there (exact copy, tokens, scope). These clarifications override the original description.

### 3. Draft scenarios

Group into the buckets below and only include those that apply to the ticket:

- **Acceptance criteria** — one scenario per stated requirement in the spec.
- **UI / visual states** — badges, colors, copy verbatim, alignment, responsive breakpoints.
- **User-role / permission variants** — every user type the spec distinguishes (logged-out, free, premium, admin, etc.).
- **Empty / error / boundary states** — zero results, invalid input, network failure, partial data.
- **Persistence** — refresh, navigation away/back, multi-tab, session expiry.
- **Cross-surface side effects** — does this feature touch other screens, exports, downstream APIs, analytics events?
- **Accessibility** — keyboard navigation, screen reader labels, focus management, tooltip exposure (only when relevant — skip for backend-only stories).
- **Regression** — what should NOT change for unaffected user types or surrounding features.

### 4. Style rules for scenarios

- **Language:** always English. Translate from whatever language the user wrote in. (Rationale: keeps the plan readable for an international team — adjust if your team standardizes on another language.)
- **Tone:** professional, terse, action-oriented.
- **Format:** pick the one that reads best per scenario:
  - Imperative: `Verify that free-tier users see exactly 5 items in the results dropdown.`
  - Given/When/Then (only when state setup matters): `Given a free-tier user with no active subscription, when they select a premium-only option, then the upsell modal opens with the verbatim title "Upgrade to unlock this".`
- **Length:** ≤180 chars so it renders cleanly in a tracker sidebar.
- **Quotes verbatim:** copy/strings come from the spec, never paraphrased.
- **No checkboxes in the text** — the tracker renders the checkbox itself.
- **No implementation detail** — describe observable behaviour, not how it's coded.
- **Flag ambiguities** with `[CONFIRM: <who/what>]` instead of guessing.

### 5. Self-review pass (mandatory, before any write)

Run this rubric against the drafted list and revise before showing the user:

- [ ] Every stated acceptance criterion maps to at least one scenario.
- [ ] Every scenario is atomic, observable, and independently runnable.
- [ ] No duplicates.
- [ ] No untestable claims ("feels fast", "looks nice").
- [ ] No implementation detail leaking into the scenario.
- [ ] All product-supplied strings and identifiers are quoted verbatim, not paraphrased.
- [ ] Negative paths and at least one regression check are present where applicable.
- [ ] Every ambiguity uses `[CONFIRM: …]` instead of a guess.

Print a one-line note for each rubric item that triggered a revision, then print the revised list.

### 6. Confirm posting (one question only)

Show the final numbered list to the user. If the ticket already has sub-tasks, mention how many existed and that the new ones will be **appended** by default. Ask exactly one yes/no question: `Post these N scenarios to <TICKET-ID> as sub-tasks? [y/N]`.

If the user has indicated auto/no-confirmation mode for the session, skip the prompt and proceed to step 7.

### 7. Post the checklist (only if the tracker supports it)

Sequentially (so the order on the ticket matches the printed list), for each scenario, create a sub-task via your tracker's API. Example shape:

```bash
curl -s -X POST \
  -H "Authorization: Bearer $TRACKER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"description":"<scenario text>","complete":false}' \
  "$TRACKER_API_BASE/stories/<ID>/tasks"
```

Stop on the first non-2xx and report the response body.

### 8. Report back

Three lines max:

```
<TICKET-ID> | <N> scenarios created
<ticket URL>
<any [CONFIRM: …] flags that still need product/design input>
```

## Errors

- `401` → token rotated/invalid. Ask for a new one, update your local secrets file, retry once.
- `404` → wrong id. Print the id used and stop.
- `422` / validation error on POST → description too long or invalid body. Print the API's error message verbatim and adjust.
- Ticket is closed/archived → warn before posting; require explicit confirmation even in auto mode.
- Description is empty → don't guess. Ask the user for one sentence of context and stop until they reply.

## Notes

- This skill writes to a shared system. In manual mode, never post without the explicit `y` from the user. In auto mode, post freely but still print the full list first so the user can spot-check the output.
- Sequential POSTs preserve ordering in the tracker sidebar.
- Sub-tasks/checklist items are usually a separate primitive from comments — post scenarios as tasks, not as a comment blob.
- Existing QA notes in comments are useful context (they often contain product clarifications) but should not be turned into tasks verbatim — re-derive scenarios from the spec instead.
