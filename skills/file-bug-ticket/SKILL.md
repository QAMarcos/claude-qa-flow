---
name: file-bug-ticket
description: File a bug (or feature/chore) ticket in your issue tracker via its REST API with a terse, budgeted description, attached screenshot evidence, owner/priority/placement filled in, and a verification GET before reporting done. Use whenever the user asks to "file a bug", "open a ticket", "criar um card", "abrir um bug", "report this to the tracker", or when manual-test hands over findings to file. Tracker-agnostic (Jira, Linear, GitHub Issues, Shortcut, ...).
license: MIT
compatibility: Any Agent Skills harness (Claude Code, OpenCode, Codex, ...). Needs shell access with curl (or equivalent) and a tracker API token. Subagents optional.
metadata:
  version: "2.0.0"
  routing: router
---

# File Bug Ticket

Creates a ticket in your issue tracker through its REST API: terse English description inside a
character budget, screenshots attached, owner / priority / placement always filled, and the result
verified before it is reported. Default type is a bug, but features and chores work the same way.

> Called directly by the user, or by `manual-test` (Step 7) with fields and body already resolved.

## Step 0 — Triage & delegation (mandatory)

This skill is a **router**. Creating a ticket is an external write — never delegate with a field
left to guess.

**Stays inline (main conversation):** resolve what is ambiguous — title, type, state, epic/project,
owner, priority, and the screenshot paths. If the token returns `401`, get a new one from the user
and update the local secrets file before delegating.

**Delegated (subagent):** read the token from env / local secrets, build the payload, create the
ticket, upload the attachments, verify with a GET and return the ticket URL. Suggested brief:

```
Follow the file-bug-ticket SKILL.md (skip Step 0).
Fields already confirmed with the user: <title / type / state / epic / owner / priority / labels / screenshots>.
Description: use the body in <path> verbatim.
Do not ask anything — if something is missing, return saying exactly what.
```

If your harness has no subagents, run it inline.

**Tier** (capability levels — `balanced` ≈ Sonnet-class, `deep` ≈ Opus-class / top reasoning tier):

| Situation | Tier |
|---|---|
| Fields and body already resolved — only build the payload, post and verify | `balanced` |
| Must draft title and description from a bug investigation (repro, evidence, severity) | `deep` |

If the subagent returns saying data was missing, resolve it with the user and **redispatch** — do not
take the work over in the main conversation.

## Configuration (fill these in for your setup)

- **`TRACKER_API_BASE`** — your tracker's REST API base URL.
- **`TRACKER_TOKEN`** — API token, read at runtime from env or a git-ignored `.env.local`. **Never
  hard-code it here, never commit it, never print it.**
- **Workspace ids** — default project/team, workflow states (at least "Backlog" and "Ready for
  Development"), your own user id as requester, custom-field ids for priority/severity. Keep them in a
  local, git-ignored notes file or in the project's agent instructions (`AGENTS.md` / `CLAUDE.md`), and
  refetch from the API when the user names an unknown team/state.
- **Owner by layer** — who owns front-end vs back-end defects (table below).

## Default field choices

When the user does not specify:

- **Type:** `bug` for a problem/error/incident; `feature` for new functionality; `chore` for maintenance.
- **State:** Backlog — keeps the ticket out of the active sprint until triaged. "Ready for
  Development" only if the user says it is prioritized.
- **Requester:** the user, when they are reporting it.
- **Language:** title and body **always in English**, whatever language the request came in.
- **Owner, priority and placement:** always filled — see below. When filing from `manual-test`,
  **mirror a sibling bug in the same epic/project** instead of these defaults.

## Owner, priority and placement — always filled

**Owner by layer** (fill in your team; the user's override wins):

| Where the defect lives | Owner |
|---|---|
| Front-end (UI state, layout, copy, client validation, component behaviour) | `<front-end owner>` |
| Back-end (API response, data, workers, 4xx/5xx, wrong payload) | `<back-end owner>` |
| Unclear / both layers | both |

**Priority + severity, proportional to the defect:**

| Level | When |
|---|---|
| Critical | Core flow down for everyone, data loss, money charged wrongly, no workaround |
| Major | Main flow broken for a segment, or wrong data shown; no reasonable workaround |
| Moderate | Flow blocked but a workaround exists (refresh, retry), or edge-case breakage |
| Minor | Cosmetic, copy, rare trigger, no functional loss |

**Placement (epic / iteration):**

1. Bug found while testing a ticket of an ongoing epic → that ticket's epic and iteration.
2. Standalone bug → your team's maintenance/bugs epic and the current iteration.
3. Never park a new bug in a "maybe never" backlog or in a closed, feature-scoped iteration.

## Description template — default: terse

**Hard budget: 1000 characters of prose, 4 sections, 1–2 lines per bullet.**
**Simple front-end bug: 500 characters.** "Simple front-end" means the defect is visible on screen and
its cause needs no correlation — wrong copy/label, layout/overflow, missing or misplaced element,
wrong state on a control. If you had to correlate network, console, DB or two systems to explain it,
it is not simple: use 1000.

**Counts:** every line of prose — Summary, the repro steps' text, the Evidence sentences, the Notes.
**Does not count:** markdown tables, fenced code blocks (a repro `curl`, a payload, a stack trace),
screenshot filenames and attachment URLs. The exemption is not a loophole: sentences inside table
cells count.

**How to stay inside it:** cut restatement (the title already says what is broken); move per-case
numbers into a table; drop hedging; keep one root-cause guess, one line; let the screenshots carry
the description. **Never pad** — 300 characters that say everything is the goal.

```markdown
## Summary
<1-2 sentences: what's broken, which AC it breaks, what it costs the user>

## Steps to reproduce
<numbered, tight — account/data used inline>

## Evidence
1. **<case/profile>** — `<id>` (<context>). <the one key fact, e.g. a before/after delta>.
   Screenshots attached (match by filename).
2. <second case, same shape — or omit>

## Notes
- <root-cause guess, 1 line>
- <sample-size / confidence caveat, 1 line, if relevant>
- <impact/priority, 1 line, if relevant>
```

Drop sections that do not apply; a simple front-end bug usually collapses to Summary + Steps +
Evidence. Never invent data the user did not provide.

**If a good reason needs more** (many genuine repro steps, several independent evidence cases, a
root-cause write-up the developer asked for) — **ask the user before posting**: state the prose
count and why the short form does not fit, and let them decide.

## Workflow

1. Read the token from env / local secrets.
2. Confirm or infer every field above. If something critical is ambiguous, ask **one** focused question.
3. Verify every screenshot path exists before uploading; if not, ask the user to confirm it.
4. **Count the description's prose** against the budget (500 / 1000). Over → cut, or ask.
5. Build the JSON with a serializer (`JSON.stringify`, `json.dumps`, `jq`) — never by string
   interpolation; long markdown with tables is what a badly escaped body breaks.
6. Create the ticket. Example shape:

   ```bash
   curl -s -X POST \
     -H "Authorization: Bearer $TRACKER_TOKEN" \
     -H "Content-Type: application/json" \
     --data @_local/ticket.json \
     "$TRACKER_API_BASE/stories"
   ```

7. Upload the screenshots through the tracker's file API (usually `multipart/form-data`) and attach
   them to the ticket. Many trackers do not preserve upload order — the body references each
   screenshot **by filename**. (Windows PowerShell 5.1 multipart is fragile — prefer `curl`.)
8. If filing from a QA run, link the bug to the parent ticket with `relates to` (never `blocks`).
9. **Verify with a GET:** fields, owner, labels, attachment count and names, the link, and that the
   description length matches the source file (no truncation).
10. Report back in ≤ 4 lines: id, title, URL, attachments.

## Errors

- `401` → token rotated. Ask the user for a new one, update the local secrets file, retry once.
- `404` on the attach/update call → wrong id; use the id from the create response, not the web URL.
- `422` / validation error → print the API's error message verbatim and adjust.
