# Severity gate: does the finding block the ticket?

Delaying a feature costs more than shipping a Low bug. **The default is not to block.** A finding
sends the ticket back to development only if it meets **at least one** of these criteria:

- **Breaks an acceptance criterion in normal use** — the happy path the ticket promises does not work.
- **Loses or corrupts data, or charges wrongly**, without the user doing anything unusual.
- **Security, privacy, or a gate/entitlement leak.**
- **Regression in a common flow** (not a failure path) with no way out for the user.

It does **not** block — it becomes a **note in the results comment** or a **Low bug linked with
`relates to`** — when any of these apply:

- **Rare trigger:** network drop mid-request, 5xx, a millisecond timing window, a state reachable
  only through fault injection (request interception/abort, network throttling). A finding that only
  exists under fault injection **never** blocks by default.
- **Easy way out:** reload, navigating again, or repeating the action fixes it, and nothing is lost
  beyond what was already lost before the fix.
- **Low exposure:** small page or audience, or a cosmetic effect.
- **No worse than the error itself:** if the app already shows an error modal or already requires a
  reload in that case, the finding only changes the detail.

When in doubt between Low and blocking, **it is Low**: approve and leave the note. Promoting a
finding to blocking is the **user's** call — not the executor's, not the reviewer's. Reviewers tend
to promote what they found; the gate exists precisely to filter that.

> Real example: a fix worked on the normal path. A second pass found that if the save request
> failed on the network or with a 5xx (simulated via request interception), the Save/Cancel buttons
> stayed stuck until reload. Recommending to send the ticket back was a mistake: the trigger is rare,
> a 5xx already opens the app's error modal, reload fixes it, and no data is lost. The ticket shipped
> as PASS with the fix suggestion in a non-blocking note.

Every finding in the report and in the proposal to the user carries an explicit label —
`blocking` or `non-blocking (Low)` — with the gate criterion that supports it, in one line.

## Before accepting any finding: check product intent

Neither the executor nor the reviewer has the final word. Before accepting a finding, check it
against product intent:

> Real example: the executor reported "multi-select broken: clicking a 2nd item does not apply".
> Opening the screenshot showed the 2nd item was, by design, a call-to-action for another product
> (stated in a sibling ticket), and the remaining items were paywalled. There was no testable pair
> — the bug did not exist. Filing it would have burned credibility with the team.

Rule: **before filing, re-read the parent ticket and its siblings looking for the sentence that
explains the behaviour.** "This is a bug" and "this is the product working" look very similar from
the outside.
