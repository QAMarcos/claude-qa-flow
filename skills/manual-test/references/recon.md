# Recon: look at the real page before writing the spec

A spec written blind from the plan guesses its locators. A guessed locator that matches nothing
fails the step, and the report then carries an `INCONCLUSIVE` or a `FAIL` that is really a scripting
error — which the reviewer has to take apart later. Recon is a short, read-only pass over the pages
the plan starts from: it records **how the page is built** so the spec can reach its elements.

## The golden rule

**Recon tells you how to reach an element. It never tells you what to expect.**

The expected result of every step still comes from the AC, verbatim. The recon captures the page as
it is today — and today may be exactly the bug. A spec whose expectations were copied from the recon
asserts the bug and turns it green.

- Never copy text, counts, order or structure from the recon into an assertion.
- An `ariaSnapshot` assertion (`toMatchAriaSnapshot`) is written **from the AC**, never pasted from a
  recon file — see `playwright-templates.md`.
- The recon never changes the plan. If the recon shows the plan cannot be executed as written (the
  entry page does not exist, the flow moved), stop and return: the orchestrator resolves it with the
  user.

## When to run it

Run it before writing the spec, unless one of these already tells you how to reach the elements:

- the project's page objects / action helpers cover the whole flow;
- the brief lists fresh knowledge-bank `locator` entries for **every** AC target and navigation
  step of the plan and says recon may be skipped (the orchestrator decides that, not you — see the
  knowledge-bank rules in the `manual-test` skill);
- the run is a single assertion on a page whose locator the brief gives from page objects or a
  fresh knowledge entry.

In every case the **brief** says "recon may be skipped"; without that line, the executor runs it.

**First-visit state** — onboarding shown once, "new"/unread badges, "recently viewed", view
counters, a dismissal the server remembers — is consumed by a recon visit before the run can observe
it. The orchestrator spots it while planning and writes in the brief "recon may be skipped —
first-visit state", or names a second fixture user for the recon. Opening a notifications or inbox
menu can also mark items as read: leave such menus out of `expand` unless the brief asks.

Say in the report whether recon ran, and if not, why.

## What recon may do — allowlist

Recon is observation. It may:

- `goto` the entry pages of the plan (the URLs in the brief, nothing discovered on the way);
- dismiss the overlays the brief lists, exactly as the spec will;
- open a menu, accordion, tab, sheet or dropdown **to look inside it** (collapsed content is often
  not in the DOM — see `evidence-discipline.md`) — only a control that declares itself a disclosure
  (`aria-expanded`, `aria-haspopup`, or role `tab`), matched by its **exact** accessible name;
- read: `ariaSnapshot()`, screenshots, a scoped list of test ids.

It may **not**: submit a form, type into a field, click a link or button that navigates away or
changes data, follow a link it found, open an email/magic link, or press anything named like
*save, delete, confirm, buy, send, sign out, mark as read*. Even a `GET` can have side effects
(one-time links, logout URLs, "mark as read") — that is why recon only visits URLs from the brief.

If an entry page can only be reached by a mutating step, skip recon for it and say so.

## Template — `_local/scripts/_recon-<slug>.spec.ts`

**Copy this template — do not rewrite it.** The brief gives the path of the ready-made file
(`assets/recon.template.spec.ts` in the `manual-test` skill); copy it to
`_local/scripts/_recon-<slug>.spec.ts` and fill in `OUT`, `ENTRIES` and the overlay dismissal,
nothing else. Its scope handling, disclosure check, popup snapshots and `meta.json` are what make
the recon trustworthy as absence evidence; an improvised whole-body dump is neither small nor
reviewable. If the brief has no path, type it in from the block below. Run it with the same
throwaway config as the spec (`-c _local/scripts/manual.config.ts`).

```ts
import { expect, test } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";

test.use({ storageState: "./playwright/.auth/user.json" });

const OUT = "_local/recon/<slug>";
// Entry points from the brief. `scope` keeps the snapshot small: prefer the region the plan works
// in (`main`, a form) over the whole body. `expand` lists the exact names of disclosures to open.
const ENTRIES = [
  { name: "list-page", url: "https://staging.<your-app>.example.com/<entry>", scope: "main", expand: [] as string[] },
];
// Popups often render outside the scoped region (portals): snapshot them separately.
const POPUPS = "[role=dialog]:visible, [role=menu]:visible, [role=listbox]:visible, dialog[open]";
const TEST_ID = "data-testid"; // match the project's testIdAttribute

test("recon: <slug>", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  for (const e of ENTRIES) {
    const meta: Record<string, unknown> = {
      url: e.url, scope_requested: e.scope, expanded: [], already_open: [], skipped_expand: [],
    };
    await page.goto(e.url);
    // Dismiss the overlays listed in the brief here — same code as the spec.

    // SPAs mount late: wait for the scope; fall back to <body> explicitly, and say so. `scope_found`
    // only says the region existed — not that its content had loaded (check the snapshot for
    // spinners / "Loading…"). A fallback snapshot is never evidence of absence.
    let root = page.locator(e.scope).first();
    try { await root.waitFor({ timeout: 10_000 }); meta.scope_used = e.scope; meta.scope_found = true; }
    catch { root = page.locator("body"); meta.scope_used = "body (requested scope not found)"; meta.scope_found = false; }
    // Every disclosure in scope, by accessible name — so a wrong `expand` name is fixed in one pass.
    meta.disclosures = await root.locator("[aria-expanded], [aria-haspopup], [role=tab]").evaluateAll(els =>
      els.map(el => (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 60)));

    for (const name of e.expand) {
      // `.or()` here only finds the disclosure to open; the no-`.or()` rule is about AC targets.
      const control = root.getByRole("button", { name, exact: true })
        .or(root.getByRole("tab", { name, exact: true })).first();
      try {
        const kind = (await control.count()) === 0 ? "missing" : await control.evaluate(el => {
          if (el.closest("a[href]")) return "a link — would navigate";
          const tab = el.getAttribute("role") === "tab";
          if (el.getAttribute("aria-expanded") === "true" || (tab && el.getAttribute("aria-selected") === "true")) return "open";
          return el.hasAttribute("aria-expanded") || el.hasAttribute("aria-haspopup") || tab ? "closed" : "not-a-disclosure";
        });
        if (kind === "open") { (meta.already_open as string[]).push(name); continue; } // a click would close it
        if (kind !== "closed") { (meta.skipped_expand as string[]).push(`${name} (${kind})`); continue; }
        const popupsBefore = await page.locator(POPUPS).count();
        await control.click();
        // Wait until it really opened before reading — then give on-demand content a moment to settle.
        if (await control.getAttribute("aria-expanded") !== null) await expect(control).toHaveAttribute("aria-expanded", "true");
        else if (await control.getAttribute("role") === "tab") await expect(control).toHaveAttribute("aria-selected", "true");
        else await expect.poll(() => page.locator(POPUPS).count(), { timeout: 5_000 }).toBeGreaterThan(popupsBefore);
        await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => {});
        (meta.expanded as string[]).push(name);
      } catch (err) {
        // eslint-disable-next-line no-control-regex
        const msg = String(err).replace(/\u001b\[[0-9;]*m/g, "").split("\n")[0].slice(0, 120);
        (meta.skipped_expand as string[]).push(`${name} (failed: ${msg})`);
      }
      // Snapshot what this expansion opened NOW — opening the next menu may close this one.
      const opened = page.locator(POPUPS);
      for (let i = 0; i < await opened.count(); i++) {
        writeFileSync(`${OUT}/${e.name}.after-${name.replace(/\W+/g, "-")}.popup-${i}.aria.yml`, await opened.nth(i).ariaSnapshot());
      }
    }

    writeFileSync(`${OUT}/${e.name}.aria.yml`, await root.ariaSnapshot()); // whole file — never truncate
    const popups = page.locator(POPUPS);
    for (let i = 0; i < await popups.count(); i++) {
      writeFileSync(`${OUT}/${e.name}.popup-${i}.aria.yml`, await popups.nth(i).ariaSnapshot());
    }
    meta.test_ids = await root.locator(`[${TEST_ID}]`).evaluateAll(
      (els, attr) => els.map(el => el.getAttribute(attr)), TEST_ID);
    // If the page is not the entry URL any more, this recon describes another page — say so.
    meta.final_url = page.url();
    meta.navigated_away = page.url().split(/[?#]/)[0] !== e.url.split(/[?#]/)[0];
    writeFileSync(`${OUT}/${e.name}.meta.json`, JSON.stringify(meta, null, 1));
    await page.screenshot({ path: `${OUT}/${e.name}.png`, fullPage: true });
  }
});
```

`locator.ariaSnapshot()` needs Playwright ≥ 1.49. On older versions, fall back to an element-scoped
`innerText` plus a scoped list of roles/labels — never `document.body.innerText`.

**Budget.** A whole-body snapshot of a busy SPA runs to tens of KB and is read into your context.
Scope to the region the plan works in. If a snapshot is still larger than ~15 KB, narrow the scope
or `grep` the file for the names you need — but never save a truncated snapshot: a cut file cannot
prove that something is absent.

## Using the recon to write the spec

For each locator the spec needs, decide which kind it is:

| Locator is for… | Found in the recon | Not found in the recon |
|---|---|---|
| **An AC target** — the element a step asserts on, or whose presence/behaviour the AC promises | "Found" means the snapshot has the role **and the exact name the AC uses**. Write the locator with that name — the AC's words, not the page's. A control with different wording is **not found** (a copy mismatch is itself a finding). | **Do not hunt for a look-alike.** Keep the locator the AC implies and run. If the step fails, it is a `FAIL` candidate — the recon backs "the element was not on the page" **only** within what it covered (below). |
| **Navigation** — a means to get to the state under test, not itself asserted | Write the locator from the snapshot. | Look in the snapshot for the control that does the same job, use it, and record the change in `script_revisions`. |

When in doubt whether a locator is an AC target, treat it as one.

**What an absence proves.** "Not in the recon" means "not in the snapshot of `scope_used`, after the
expansions in `expanded` (and the containers in `already_open`), plus the popup snapshots" — nothing
more. Each expansion's popups are saved right after it (`<entry>.after-<name>.popup-<i>.aria.yml`),
because opening the next menu may close the previous one; a menu whose file is missing was not
captured, whatever `expanded` says. Content in a portal, in a container the recon did not open, or outside a narrow scope is
simply not covered. A snapshot taken on the fallback (`scope_found: false` in `meta.json`) proves no
absence at all, and neither does one that still shows a spinner or "Loading…" (`scope_found` says the
region existed, not that its content had loaded) or one with `navigated_away: true`. Cite the exact files and the
`meta.json` when you use the recon as absence evidence.

## Script revisions are not retries

"No retries" forbids running the same thing again hoping for green. Fixing the **mechanics** of a
script and running it again is different — but only if it is visible.

`script_revisions` lists **every deviation from the brief and every change to the spec after its
first run**: step, before → after, reason, and the file that justified it (recon, log).

**Allowed revisions — the canonical list** (the orchestrator and the reviewer check against it):

1. A **navigation** locator that did not match (the brief named a link that is a button, a renamed
   menu entry).
2. An entry URL mistyped in the spec — the brief's URL is the truth.
3. A dismissal for an overlay the brief lists.
4. Evidence capture that touches no assertion: extra or focused screenshots, read-only logging.
5. Run mechanics in the throwaway config: `outputDir`, reporter, viewport-independent screenshot
   settings.
6. Test structure that changes no assertion: after a failed **action** ended the shared test,
   moving the steps that do not depend on it into their own `test()` (with their own setup) — say
   in the report that they ran without the earlier steps' state; a `try/finally` that captures
   evidence and lets the failure propagate.

**Never:** change an expected value, remove or weaken an assertion (`expect` → `expect.soft` on a
result is fine; deleting it is not), add waits, add a `try/catch` that swallows a failure, raise
timeouts, use a forbidden interaction workaround, or swap an AC target for a different element.

**Keep every run.** Playwright empties its output folder on each run, so give each run its own:
`npx playwright test -c … --output _local/test-results/run-<n> … 2>&1 | tee _local/logs/run-<n>.log`.
The reviewer compares the runs.

A navigation revision corrects the **brief**, not the product: report it under *Script revisions*,
not as a finding. It becomes a finding only when the AC itself names that control (then it was an
AC target, and the table above applies).

## What recon is not

- **Not evidence.** A recon screenshot never backs a step's `PASS`/`FAIL` — steps cite screenshots
  from the run. (A recon snapshot can back "the element was not on the page", within its coverage.)
- **Not a crawler.** It visits the brief's entry pages, not the site.
- **Not a plan.** It does not add, drop or reorder steps.
