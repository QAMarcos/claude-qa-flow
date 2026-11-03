# Knowledge bank: what the next run should not have to rediscover

Every run learns something the next one will need: the overlay that appears after each reload, the
control that is a button and not a link, the behaviour that looks like a bug but was a product
decision. Without a place for it, that knowledge lives in someone's head or in free-text notes that
nobody re-checks — and a stale note makes the next run assume a failure that was already fixed.

The knowledge bank is a folder of small Markdown files in the project under test. **The orchestrator
reads it** to build the brief, and **writes it only with the user's approval**. The executor and the
reviewer never edit it.

## Where it lives

`<project>/.qa-flow/knowledge/` by default (set another *knowledge root* in the skill's
Configuration). One file per product area, plus one for the environment:

```
.qa-flow/knowledge/
├─ _environment.md     bot protection, auth fixtures, seeding, console noise — app-wide
├─ listings.md         one file per area of the product
└─ checkout.md
```

Whether to commit it is the team's call. Committed, it is shared and reviewed in merge requests
like any other file; ignored, it is one person's notes. It is **not** the scratch root: `_local/`
is throwaway, the knowledge bank is curated.

> **Why not a section in `AGENTS.md`?** `AGENTS.md` is loaded into every session — the executor's
> included — so everything in it reaches the executor unfiltered: an `intent` entry would bias its
> verdicts, and a `known-bug` pointer would skip the tracker check. Only harmless, app-wide `gotcha`
> and `data` notes belong there; `locator`, `intent` and `known-bug` entries need the folder, where
> the orchestrator routes them.

## Entry format

```markdown
---
area: listings
pages: /listings, /listings/:id
---

## Onboarding dialog after every load
type: gotcha
summary: A "Welcome" dialog opens after every goto/reload and covers the page; dismiss it with its "Got it" button before any screenshot.
source: run 2026-10-23 listings-rfq
last_verified: 2026-10-23

## Filters control is a button
type: locator
page: /listings
element: control that opens the filter panel
locator: getByRole("button", { name: "More filters" })
source: run 2026-10-23 listings-rfq
last_verified: 2026-10-23
```

One `##` heading per entry, then `key: value` lines (one line each). Fields:

| Field | Required for | Meaning |
|---|---|---|
| `type` | all | `gotcha`, `locator`, `intent`, `known-bug` or `data` (see below) |
| `summary` | all but `locator` | One or two sentences. What to do, not the story of how it was found. |
| `source` | all | Where it comes from: a run (`run <date> <slug>`), a ticket, a PO comment. |
| `last_verified` | all | `YYYY-MM-DD` — the last time a run or a person confirmed it. |
| `page`, `element`, `locator` | `locator` | Path pattern, what the element is for, the Playwright locator that worked. |
| `ticket` | `intent`, `known-bug` | The ticket or comment that holds the decision / the bug. |

### Entry types

- **`gotcha`** — environment or app behaviour every run has to handle: an overlay, a WAF header, a
  slow first load, a URL that seeds state, baseline console errors to ignore.
- **`locator`** — how to reach an element that is not obvious: a link that is a button, an icon
  button with no accessible name (reach it by test id), a control inside a sheet on mobile. Only
  locators that worked in a run, written in the project's preferred locator style.
- **`intent`** — "this looks like a bug but is the product working", with the ticket or PO comment
  that says so. The most valuable entry — it stops false bugs — and the riskiest: products change.
- **`known-bug`** — a **pointer** to a tracked bug that affects runs in this area (`ticket` +
  one-line symptom). The tracker is the source of truth for its state; the entry only says where
  to look.
- **`data`** — test data that works: which fixture user has which tier, which record has the
  edge-case shape, how to seed a state. Never credentials.

### Never in the knowledge bank

- Credentials, tokens, API keys, session cookies, `storageState` contents.
- Personal data: real people's emails, phone numbers, names, addresses. Use the fixture's role
  ("the free-tier fixture user"), not the person. (The checker catches secrets, emails and query
  strings; phone numbers, names and addresses are on whoever approves the entry.)
- URLs with query strings — they carry session ids, tracking params and one-time tokens. Write
  the path, and describe the parameters in words if they matter.
- Verdicts. An entry never says "ignore failures here" or "this step always passes".

## Reading it — orchestrator, Step 1

After listing the known bugs, read the files for the areas the ticket touches (and
`_environment.md`). Run the bundled checker first so stale entries are flagged:

```bash
node <skill dir>/scripts/check-knowledge.mjs <knowledge root> --max-age 30
```

Route each entry to where it belongs — never paste the whole bank into the brief:

| Type | Goes to | How |
|---|---|---|
| `gotcha` | Executor brief — *App/environment gotchas* | As an instruction ("dismiss X with its close button after every reload"). |
| `locator` | Executor brief — *App/environment gotchas* | As "reach <element> with <locator> (verified <date>)". As a reason to skip recon, fresh `locator` entries count **only when they cover every AC target and every navigation step of the plan** — list them (other reasons to skip it are in `recon.md`). Anything less, or any stale one ("verify — last seen <date>"), and recon runs. |
| `known-bug` | Executor brief — *Known bugs* | **Only after checking its state in the tracker.** Closed / not reproducible → leave it out and propose updating the entry. Tracker unreachable → leave it out and tell the user which pointers could not be checked. |
| `intent` | **Reviewer** prompt and your own product-intent check — **not** the executor | Fresh entries only, as "verify against <ticket>: <summary>", never as a verdict. The reviewer re-reads the source and decides whether it still applies. A **stale** `intent` goes to the user as a question ("is DEMO-12's decision still current?"), not to the reviewer, until they confirm it. |
| `data` | Executor brief — the fixture/seeding lines | As written. |

An `intent` entry never demotes a finding by itself. If the current ACs contradict it, the AC wins
and the entry is proposed for removal. A **stale** `intent` is not cited anywhere — results, bug
bodies, comments — until the user confirms it or its source is re-read in this round (and then the
entry is proposed for renewal).

**Entries the checker flags are not routed.** An entry with a checker error (missing field, query
string, anything that looks like a secret or an email) stays out of the brief and the reviewer
prompt — propose the fix instead. If what was flagged is a real credential or personal data, never
copy it anywhere: tell the user at once and propose deleting it (and rotating a credential).

**Freshness.** An entry older than the window (default 30 days) is still read, but marked
"unverified since <date>" wherever it goes. A stale `locator` never replaces recon; a stale
`intent` is a question for the user, not context for the reviewer.

## Writing it — orchestrator, after the review, with the user's approval

Proposing knowledge updates is its own step after the review (Step 6) — it does **not** depend on
filing anything in the tracker, because ad-hoc runs and clean passes also teach something.

1. **Collect candidates** from the reviewed run:
   - gotchas the executor had to handle that the brief did not list;
   - `locator` entries for elements the spec reached on a step the reviewer **accepted as `PASS`** —
     never from a `FAIL`, `INCONCLUSIVE` or a step whose locator came from a script revision the
     reviewer questioned, and never from the recon alone (the recon may show the bug);
   - `intent` entries only for behaviour the reviewer or the user confirmed as intended **with a
     source** (ticket, PO comment). No source, no entry;
   - entries the run **contradicted** — propose updating or removing them;
   - entries the run **confirmed** — propose bumping `last_verified`. For an `intent` entry,
     "confirmed" means the reviewer or the user **re-opened its source** (ticket, PO comment) in this
     round and it still says the same; an `intent` that merely "explained" a finding is not
     confirmed, and its date stays.
2. **Check before showing.** Write the proposed files to a scratch copy (`_local/kb-proposal/`) and
   run the checker on it; fix anything it flags. The user approves exactly what will be written.
3. **Show the user the proposed change** as a short diff per file (added / updated / removed
   entries, one line each), as its own question — even when it comes in the same message as the
   run's results and the filing proposal.
4. **Write only after a yes to the knowledge-bank change specifically.** A yes to filing bugs or
   posting the comment (Step 7) is not a yes to this; silence is not a yes. Keep each file's line
   endings and untouched lines as they are, so the written diff is the one that was approved. Then
   run the checker on the real files. If anything still needs changing after the write, show that
   change again before making it.

Never record an expected result, a verdict or a whole report. The bank holds what helps the next
run *reach and judge* the page — the next run's expectations still come from its ticket.

**Size.** A file past ~40 entries or ~12 KB is a sign of noise: when proposing an update, also
propose pruning entries nobody has verified in a long time or that duplicate another.

## The checker

`scripts/check-knowledge.mjs` (bundled with this skill, no dependencies) validates every file in the
knowledge root and exits non-zero on errors:

- **errors** — missing required fields, unknown `type`, malformed `last_verified`, front matter not
  closed, a URL with a query string (outside `locator` / `ticket` / `source`), something that looks
  like a credential — tokens and keys of the common providers, bearer / basic auth (also as a JSON
  header), credentials inside a URL, cookies (also as a JSON header or a pasted `storageState`
  cookie), and `password` / `secret` / `token` / `api key` / `session` assignments whose **value**
  looks secret (≥ 8 characters mixing letters with digits or symbols, or ≥ 20) — or an email
  address (printed masked; `example.com` / `.test` addresses allowed — a real inbox domain, even a
  test-mail provider's, is an error);
- **warnings** — entries older than `--max-age` days (default 30), a query string in `locator` /
  `ticket` / `source`, duplicate headings, unknown or repeated fields, free text inside an entry,
  files over the size budget.

It does **not** catch — and the person approving the entry must: phone numbers, names, addresses,
identity-document numbers; a secret written as prose ("the password is hunter"), short (< 8) or
letters-only; a value typed into a `.fill("…")`; a header or variable whose name is not
credential-like. To keep ordinary notes routable it deliberately lets through hyphenated words
(`single-use`), quoted UI copy, env-var names (`QA_FREE_PASSWORD`) and env references
(`$QA_PASSWORD`, `process.env.X`) — the environment is where secrets belong.

`--json` prints a machine-readable summary (the orchestrator uses its `stale` list to mark entries in
the brief).
