# Filing bugs and commenting on the ticket

Only after the independent review (Step 6) and with the user's go-ahead — these are writes to a
shared system. Everything written here is in **English**.

## Organizing the bugs you file

A QA pass that produces N loose bugs forces the product owner to rebuild the relationships. The
structure that works is **child bugs linked to the parent ticket + one index comment on the parent**:

1. **One bug = one root cause.** Symptoms of the same cause go **inside** the same bug ("Other
   symptoms" folded into Notes), not into separate tickets. A separate ticket only when the fix can be
   made independently.
2. **Mirror the fields of a sibling bug in the same epic/project** (fetch it) instead of the tracker
   defaults: epic, team/group, workflow state, requester, labels. The bug lands in the queue and board
   the team already watches.
3. **Owner:** the parent ticket's owner unless told otherwise — they are the one who will fix it.
4. **Link each bug to the parent with `relates to`.** Never `blocks`: a bug with its own ticket
   follows its own lifecycle and does not hold the parent. If a finding is genuinely blocking (per
   the severity gate), what changes is the *recommendation* for the parent's column, not the link type.
5. **Attach the evidence on the bug.** Many trackers do not preserve upload order on display, so the
   description identifies each screenshot **by filename**, never "in order".
6. **Verify what was created with a GET** before reporting done: fields, owner, labels, attachment
   count and names, the link, and that the description was not truncated (compare its length with the
   source file). Long descriptions with markdown tables are what breaks most often in a badly escaped
   POST — build the JSON with a serializer (`JSON.stringify`, `json.dumps`, `jq`), never by string
   interpolation.

The bug body itself (terse template, character budget) is defined by the `file-bug-ticket` skill.
Write the body **yourself, to a file**, and hand it over verbatim — a long description rewritten by a
third party loses the precision the evidence supports.

## The comment on the parent ticket

One comment, short, acting as an index. **Ceiling: 800 characters of prose.** Structure:

- **What passed** — one paragraph, not a 12-row table. The detail lives in the bugs.
- **Bugs filed** — id and **full title** of each one. Mark which, if any, is blocking; the rest ship
  as Low, and the comment says what ships broken.
- Known bugs that reproduced, marked as already tracked (so nobody re-files them).
- **Needs a product decision** — numbered questions, each quoting the conflicting AC text. This
  unblocks the PO without becoming a bug.
- **Not verifiable yet** — what was left out, with the dependency ticket.

**The 800 limit applies to every comment this skill posts**, not only the index: ad-hoc results,
retests, answers to a PO question.

- **Counts:** every line of prose you write.
- **Does not count:** markdown tables (scenario matrix, PASS/FAIL per AC), fenced code blocks
  (repro `curl`, payload, log excerpt), ticket ids/titles listed, and the `### Evidence` section.
- The exemption is not a loophole: a sentence inside a table cell still counts.

**How to fit:** the comment is an index, not a report. Step-by-step, expected/observed and evidence
detail live in the bugs and in the Step 5 report. Cut the run narrative ("I navigated to X, applied
filter Y"), what is already in the bug titles, and every hedge. Never pad — 200 characters that say
everything is the goal.

## Evidence in the comment

If the comment is the index of bugs (which already carry the evidence), no need to re-attach. If the
comment is the **only** artifact — QA with no bug filed, or ad-hoc — the evidence ships with it:

1. Upload each PNG through the tracker's file/attachment API; collect the returned URLs.
2. Embed them under an `### Evidence` section, one captioned image per step/finding:
   `![<caption>](<url>)`.
3. Post the comment **with** the Evidence section. If you posted text-only by mistake, edit the same
   comment instead of adding a second one.

## Other follow-ups

- **Mark checklist items complete** (when the plan came from the ticket's checklist): only steps that
  passed cleanly. Ask once before mutating.
- **Do not move the ticket between columns.** Suggest the state change; the user decides.
- **Record what the next session would have to rediscover** in your harness's persistent memory or
  project notes (e.g. `AGENTS.md` / `CLAUDE.md`): a trap that produced a false finding, the feature's
  state (mocked / no backend yet), or an environment bug that **stopped** reproducing — stale notes
  make the next run assume a failure that was already fixed.
