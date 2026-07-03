---
name: manual-test
description: Execute exploratory/manual QA against a web app, driven by either a ticket's test plan or a single ad-hoc scenario the user describes. Use whenever the user asks to "run a manual test", "fazer um teste manual", "execute this scenario", "validate this ticket manually", "manual test for TICKET-XXXX", or otherwise wants the agent to step through a behavior in the real app and report pass/fail with evidence. Pulls context from the ticket + linked docs, asks the user for anything it cannot access, and drives the app via a one-off Playwright run (headed by default) reusing this repo's fixtures.
---

# Manual Test

Drives manual / exploratory QA against a web app. The agent reads the test context (from an issue-tracker ticket or directly from the user), executes the scenario by piloting a real browser via a one-off Playwright script, captures evidence, and reports pass/fail. Does **not** commit any test files — every script written here is throwaway.

> Pairs with the `create-test-plan-scenarios` skill: that skill produces the checklist of scenarios; this one executes them.

## Two modes

The skill always runs in one of these:

- **Ticket mode** — user passes a ticket id (`TICKET-1234`, a bare number, or a full URL). The skill loads the ticket, derives the test plan from the description / acceptance criteria / existing checklist, and runs each item in order.
- **Ad-hoc mode** — user pastes a single scenario in plain language. The skill executes that one scenario only, no ticket lookup.

If the user gives both a ticket id AND an ad-hoc scenario, ad-hoc wins; ask whether to still pull the ticket for context.

## Configuration (fill these in for your setup)

- **App under test** — set your environment URLs, e.g.:
  - Staging: `https://staging.<your-app>.example.com/`
  - Production: `https://<your-app>.example.com/`
  - Default to **staging** unless the user says otherwise. Never hit production without an explicit instruction in this turn.
- **E2E repo** — run this skill from your Playwright e2e project so it can reuse existing fixtures and page objects.
- **Auth fixtures (reuse, don't rebuild)** — reuse your project's stored `storageState` file(s) so login is free (e.g. `playwright/fixtures/loginAuth.json`). See "Auth & secrets" below.
- **Page-object helpers** — prefer your project's existing page objects / action helpers over raw selectors when one already exists for the flow under test.
- **Evidence output** — write screenshots/video to an untracked folder (e.g. `evidence/`).
- **Scratch scripts location** — write throwaway scripts to a folder ignored by git (e.g. `playwright/manual/` or a local scratch dir) so they never pollute the e2e project's worktree.

## Auth & secrets

- **Tracker token:** read it at runtime from a local secrets file or environment variable (e.g. `.env.local`) — **never paste it inline** and never commit it. On `401`, ask the user for a fresh token, update the local file, and retry once.
- **App credentials:** keep test-user credentials in a local `.env` (git-ignored). Generate the `storageState` fixture(s) from those via your project's global-setup / auth-setup step. If a fixture file is missing or stale (older than the session lifetime), regenerate it (e.g. run the auth-setup project) or ask the user to refresh it. **Never print credentials or tokens to the terminal.**
- **Bot-protection / WAF:** if your app sits behind a bot-protection layer, CDN challenge, or WAF, your automated session may need a specific `userAgent` or header to avoid a verification challenge. Configure whatever your infra requires in the throwaway config's `use` block, sourcing any required value from env — never hard-code a secret. If you don't know what's needed, ask the user; a silent challenge page looks like a "login failed" but isn't.

## Workflow

### 1. Resolve mode & gather context

**Ticket mode:**
1. Normalize the id to what your tracker API expects.
2. Fetch the ticket via your tracker's API (`Authorization: Bearer $TRACKER_TOKEN`).
3. Pull: title/name, description, type, custom fields, comments, related-ticket links, and any existing checklist/sub-tasks.
4. For each markdown link in description / comments (Google Docs, Figma, internal wikis), try `WebFetch`. If it 401s, redirects to login, or returns junk:
   - **Ask the user to paste the relevant content.** Be specific: `I couldn't access <URL>. Can you paste the relevant content / screenshot here?`
   - Wait for the reply before moving on. Do not invent expectations to fill the gap.
5. Read every comment — product owners often clarify copy, IDs, edge cases in comments. Those override the description.

**Ad-hoc mode:**
1. Take the user's scenario text verbatim.
2. If it references external context ("as in ticket TICKET-XXXX", "like in Figma X", "see doc Y"), follow the same fetch-or-ask loop as ticket mode.

### 2. Draft an executable plan

Convert the context into a numbered list of **atomic, observable steps**. Each step has:

- A **precondition** (logged in as which user? on which screen?).
- An **action** (one user interaction — click, type, navigate).
- An **expected result** (verbatim copy from the spec when given; otherwise the observable behavior implied).

Keep steps tight; one observation per step. In ticket mode, if the ticket already has a QA checklist, use it as the source of truth — don't re-derive.

Show the plan to the user before executing **only when**:
- The ticket is ambiguous and you had to make non-trivial assumptions.
- The plan would take more than ~10 steps.
- You're about to test something destructive (delete, payment, sending an email).

Otherwise proceed silently to step 3 — the user invoked this skill to see the test run, not to re-approve it.

### 3. Pick the execution mechanism

Default: **one-off Playwright script, headed**, written to your git-ignored scratch folder (e.g. `playwright/manual/_manual-<short-slug>.spec.ts`). Reuse an existing `storageState` fixture so login is free.

Template (applies Playwright best practices — see "Playwright best practices" below):

```ts
import { test, expect } from "@playwright/test";

// Reuse the project's stored auth so login is free.
test.use({ storageState: "./playwright/fixtures/loginAuth.json" });

test("manual: <one-line description>", async ({ page }) => {
  await page.goto("https://staging.<your-app>.example.com/<entry-point>");

  // Dismiss any app-specific onboarding / marketing modal that overlays the page
  // after navigation, if your app shows one (otherwise it ruins evidence screenshots).

  // Step 1: <action> — prefer role/label-based locators over raw text/CSS.
  await page.getByRole("button", { name: "<accessible name>" }).click();

  // Assert the observable expected result with a web-first (auto-retrying) assertion.
  await expect(page.getByRole("heading", { name: "<verbatim copy from spec>" })).toBeVisible();

  await page.screenshot({ path: `evidence/manual-step-1-${Date.now()}.png`, fullPage: true });
});
```

**Pair it with a throwaway config** so you (a) skip the repo's `globalSetup` (which would force an unnecessary login) and (b) configure any bot-protection `userAgent`/header your infra needs. Template:

```ts
import { defineConfig, devices } from "@playwright/test";
import "dotenv/config";

export default defineConfig({
  testDir: "./",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  use: { screenshot: "on", trace: "off" },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // If your app is behind a bot-protection/WAF layer, add the required
      // userAgent/header here, sourcing any token from env — never hard-code it.
      // userAgent: `... ${process.env.YOUR_WAF_TOKEN ?? ""}`,
      launchOptions: { headless: false },
    },
    timeout: 45 * 60 * 1000,
  }],
});
```

Run with:

```powershell
npx playwright test -c playwright/manual/manual.config.ts _manual-<slug>
```

Forgetting the `-c` flag pulls in your project's `globalSetup` (slow, may fail on stale fixtures) and skips any bot-protection config.

Stream long output in the background and watch it with the Monitor tool.

**Fallbacks:**

- **No Playwright path possible** (mobile-only flow, third-party iframe blocking automation, payment provider sandbox): switch to **guided mode** — print the steps one by one, ask the user to perform each, and wait for their observation. Compare against expected and record pass/fail.
- **Step requires a state you can't reach via the standard fixture** (specific account flag, paid plan, seeded data): pause and ask the user how to seed it, or whether to use a different fixture/user. Don't fabricate one.

### 4. Execute

For each step:
1. Perform the action (Playwright `await page.…` or a guided instruction to the user).
2. Verify the expected result — a web-first `expect()` for automated; literal text comparison from the user's reply for guided.
3. Capture evidence:
   - Automated: full-page screenshot named `evidence/manual-<slug>-step-<n>-<timestamp>.png`.
   - Guided: ask the user to attach / paste a screenshot, save it to `evidence/` with the same naming.
4. Record **observed vs. expected** in a working buffer. Do not stop on the first failure — continue through the remaining steps unless a step is blocking (e.g. couldn't open the page at all). Failures downstream of a blocked step → mark as `BLOCKED`, not `FAIL`.

When the result mismatches expectation, do **not** patch around it (no extra retries, no waits beyond reasonable Playwright defaults, no skipping the assertion). The mismatch is the finding. When it's a real app bug, the finding goes into the report — do not hide it or work around it in the test.

### 5. Report

**Language rule:** every artifact that will be shared with the team — final report, evidence captions, screenshot filenames, ticket comments, bug titles/descriptions — is written in **English** so it reads professionally for an international team. Only the conversational back-and-forth with the user may stay in their language. (Adjust if your team standardizes on another language.)

Single block, with this format:

```
Manual test — <ticket id or "ad-hoc"> | <env: staging/prod> | <PASS / FAIL / PARTIAL>

Step 1: <description> — ✅ PASS / ❌ FAIL / ⚠️ BLOCKED
  Expected: <…>
  Observed: <…>
  Evidence: evidence/<file>.png

Step 2: …

Summary: <one-line — what worked, what didn't, what's still unverified>
Suggested next action: <e.g. "open a bug with the evidence from step 3" | "no action — flow OK" | "ask PO about <ambiguity>">
```

Keep step bodies tight — 2-3 lines each. Quoted strings from the spec stay verbatim regardless of language.

### 6. Optional follow-ups (only if the user asks)

All write artifacts in this step are in **English** — see the language rule in step 5.

- **Open a bug ticket:** file it in your tracker with the report (English) + screenshots.
- **Post results back to the ticket** (ticket mode only): add a comment via your tracker's API with the English markdown summary. Ask once before posting; it's a write to a shared system.
  - **ALWAYS attach the evidence screenshots — a results comment without evidence is incomplete.** Upload each evidence PNG via your tracker's file/attachment API, then embed the returned URLs in the comment under an `### Evidence` section, one labelled image per step/finding: `![<caption>](<url>)`. If you already posted text-only, edit the same comment to append the Evidence section rather than adding a second comment.
  - Captions in English; one image per step/finding so the reader can map evidence → result.
- **Mark checklist items complete** (ticket mode, when the plan came from the ticket's checklist): mark only steps that passed cleanly via your tracker's API. Ask once before mutating.

## Rules

- **Faithful execution.** Use the exact URLs, copy strings, IDs, account types from the ticket/spec. If something is missing, ask — do not improvise.
- **No app-side workarounds.** If the test reveals a real bug, the test fails. Don't add retries or `try/catch` to make a failing step look green.
- **Never commit the throwaway script.** The scratch script is disposable and lives in a git-ignored folder. Delete it at the end of the run unless the user explicitly asks to keep it. (Tip: keeping reusable scratch scripts locally lets you re-run the same flow for future validations of the same pages — just keep them out of the tracked worktree.)
- **Staging by default.** Production runs require an explicit "run on prod" / "test on prod" in this turn.
- **One scenario at a time in ad-hoc mode.** If the user pastes multiple, ask which one first — running several without per-step feedback loses signal.
- **Never print secrets.** Tokens and credentials are read from local files/env and never echoed to the terminal.
- **Be explicit when you can't access something.** "I couldn't open Figma X — please send me a screenshot of component Y" is better than a guess.
- **Evidence always ships with the result.** Whenever you post results (or open a bug), upload and embed the evidence screenshots in the same artifact — never post a results comment without the images.

## Playwright best practices

Applied throughout the templates above; keep them in mind when writing each step:

- **Locator priority:** `getByRole` → `getByLabel` / `getByPlaceholder` → `getByText` → `getByTestId` → CSS/XPath (last resort). Role-based locators match how users and assistive tech perceive the page and are the most resilient.
- **Web-first assertions:** always prefer auto-retrying assertions (`await expect(locator).toBeVisible()`, `.toHaveText()`, `.toHaveURL()`, …) over generic truthiness checks or manual `waitForTimeout`. They retry until the condition holds or the timeout fires, eliminating flakiness.
- **No hard waits:** never `page.waitForTimeout(...)` to "let the page settle". Assert on the observable state instead.
- **Reuse `storageState`:** start authenticated by loading a stored session fixture — don't script the login UI in every scenario.
- **Reuse existing page objects:** prefer your project's action helpers/page objects over raw selectors when one already covers the flow.

## Errors

- **Tracker 401** → token rotated. Ask the user, update the local secrets file, retry once.
- **Tracker 404** → wrong id. Print id used and stop.
- **Playwright login failure** (`storageState` expired/invalid) → regenerate the auth fixture (re-run the auth-setup step) or ask the user to refresh `.env` credentials. Don't paste secrets. (If the app is behind bot-protection, confirm the required `userAgent`/header is configured — a challenge page looks like a login failure.)
- **Selector not found / element not visible** within a reasonable wait → that's a test finding, not a tooling error. Report it as the step's observation.
- **External link unfetchable** → ask the user for the content. Don't proceed with guesses.

## Notes

- This skill is read-heavy on the tracker API and write-light. Writes (comments, task completion) only happen with explicit confirmation in the same turn.
- Keep the evidence folder untracked — safe to dump screenshots there freely.
- If the same scenario will be re-run often, suggest promoting it to a real committed spec — but only as a suggestion; don't do it unprompted.
