# Promotion criteria: is this scenario worth a place in the regression suite?

Every committed test is paid for on every run, forever: CI minutes, flake triage, updates when the
UI changes. A suite full of one-off checks gets slower, flakier and less trusted — and a red run
that everybody ignores protects nothing. Promote **few, strong** scenarios. "We tested it once
manually" is not, by itself, a reason.

Used by `promote-to-regression` (one scenario: promote or not?) and by `scan-regression-candidates`
(many scenarios: which are worth it?). Score each candidate on the two axes below, then apply the
disqualifiers.

## Value — what breaks if this regresses (0–7)

| Criterion | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Criticality** — money, data, access | cosmetic / informational | secondary flow, workaround exists | core flow of a feature users rely on | revenue, data loss/corruption, security, entitlement or paywall gating |
| **Bug history** — has it actually broken? | never | a bug was found here once | regressed **after** being fixed, or broke more than once | — |
| **Recurrence** — how often is it tested by hand? | once | 2–3 runs / tickets | re-tested on most releases, or across ≥ 4 tickets | — |

## Cost — what it takes to keep it green and honest (0–7)

| Criterion | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| **Determinism** | standard fixture, no timing | needs a wait on a real async signal (network, job) | depends on a third party, sandbox, email, or a race | only reproducible with fault injection or by luck |
| **Data dependency** | creates its own data, or uses fixture data | relies on stable seeded data | relies on a specific record in a shared environment that can change or vanish | — |
| **Volatility** of what it asserts | behaviour / state (saved, charged, blocked, counted) | stable structure (fields of a form, options of a menu) | marketing copy, pixel layout at one width, ordering that is not a rule | — |

### Scoring notes

- **Bug history vs. recurrence — no double counting.** Bug history counts *bugs on this outcome*;
  recurrence counts *manual re-tests* (retest passes, release checks, tickets that re-exercised the
  flow). Ten bugs re-tested once each are bug history 2, not also recurrence 2 by themselves.
- **Data owned by the suite** — a seeded fixture account that only the suite uses scores data 1
  even in a shared environment; a one-time admin step to create it is a setup need ("needs: …"),
  not a cost point. Data a person created by hand and others also use is 2.
- **Third parties with a harness** — a payment sandbox or email inbox the suite already drives
  safely scores determinism 1, not 2.
- **One outcome, several pages** — "the value saved on Settings appears on the public profile" is
  one candidate spanning both pages, not two.
- **Already exercised by another spec on the way** — if another spec walks the same path without
  asserting this outcome, propose extending it; if extending it would muddy that spec, `MAYBE` with
  the reason.

## Decision

- **PROMOTE** — Value ≥ 4 **and** Criticality ≥ 2 **and** Cost ≤ 2, and no disqualifier. (A
  cosmetic flow that broke twice is still cosmetic: bug history and recurrence alone never promote.)
- A candidate whose **design depends on an open question** (which fields trigger a review, whether
  the feature is live) is `MAYBE` until the question is answered — list the question.
- **MAYBE** — Value ≥ 4 but Cost 3–4 (say what would lower it: a seeding helper, a fixture user, a
  stub for the third party), or Value 3 with Cost ≤ 1.
- **SKIP** — everything else. Say which criterion decided it, in one line.

Always state the score as `value V/7 · cost C/7` with one line per non-zero criterion — the user
must be able to disagree with a number, not with a feeling.

## Disqualifiers (SKIP regardless of the score)

- **Already covered** by the committed suite — same route and same assertion. Search the suite
  before scoring; a partial overlap means "extend the existing spec", not a new one.
- **Probe, recon or debug scripts** — `*-recon`, `*-probe`, scripts that only dump text, list
  controls or crop screenshots. They were tools, not tests.
- **No accepted result** — runs that ended `BLOCKED`, `INCONCLUSIVE` or `PO-DECISION` with no later
  reviewed `PASS`. A spec needs a verified expected behaviour to assert. A `PASS` that no
  independent reviewer accepted caps the candidate at `MAYBE` ("needs a reviewed run").
- **The assertion only exists under fault injection** (aborted requests, throttling) unless that
  exact failure shipped as a real, severe bug.
- **Asserts a currently-open bug as green.** A test for a known open bug goes in only through the
  suite's **own** known-defect convention (it may be `test.fail()`, `test.fixme()`, a skipped test
  with the ticket in the title — or an explicit ban on all of them). Read the suite before
  suggesting one; if it has no convention, or forbids them, the bug's scenario waits until the fix.
- **Production-only or destructive** — real payments, real emails to real people, deleting shared
  data — unless the suite already has a safe harness for it.
- **Feature flag on its way out**, or a page scheduled for removal.

## What a strong regression scenario looks like

- One **user-meaningful outcome** per test (the filter is saved and survives a reload; the paywall
  blocks the free user; the export contains the rows on screen) — not a tour of every control.
- Asserts **behaviour and state**, ideally confirmed server-side or after a reload — not copy that
  marketing will change next sprint.
- **Expected values from the ticket's ACs** or the product's rules, never from what the screen
  showed during the manual run.
- Reaches the state through the suite's own fixtures, page objects and seeding — no dependency on
  something a person clicked by hand on staging last month.
- Covers the **variant that broke**: if the bug was "works with no filter, breaks with a filter",
  the test applies the filter.

## Folding, not adding

Several candidates on the same route or flow usually make **one** spec with a few `test.step`s, or a
parameterised test over the variants (`for (const tier of [...])`), not N specs. When scoring a
group, score the merged scenario.
