# Playwright templates for throwaway runs

Everything here is written under the git-ignored scratch root (default `_local/`):

```
_local/
├─ scripts/          throwaway spec + config (and the recon spec)
├─ recon/<slug>/     recon output: aria snapshots, test ids, screenshots — see recon.md
├─ evidence/<slug>/  screenshots, video, trace
├─ logs/             run output (one log per run: run-<n>.log)
└─ reports/          the reviewed result of each run: <slug>.json (orchestrator, after Step 7)
```

Never put these files in the committed suite folder or in the repo root.

## Spec — `_local/scripts/_manual-<slug>.spec.ts`

```ts
import { test, expect } from "@playwright/test";
// If the project has page objects / action helpers for this flow, import and prefer them.

// Reuse the project's stored auth so login is free.
test.use({ storageState: "./playwright/.auth/user.json" });

// One test for the sequential plan, one test.step per plan step (see "One test()" below).
test("manual: <one-line description>", async ({ page }) => {
  const shot = (n: number) =>
    page.screenshot({ path: `_local/evidence/<slug>/step-${n}-${Date.now()}.png`, fullPage: true });

  await test.step("1. <action from the plan>", async () => {
    await page.goto("https://staging.<your-app>.example.com/<entry-point>");
    // Dismiss any onboarding / marketing overlay your app shows after navigation — after EVERY
    // goto/reload that can trigger it. Otherwise it covers the page and ruins the evidence.

    // Action — prefer an existing helper; otherwise role/label-based locators (names from the AC).
    await page.getByRole("button", { name: "<accessible name>" }).click();

    // Result — web-first and SOFT: a failed expectation is recorded and the next steps still run.
    await expect.soft(page.getByRole("heading", { name: "<verbatim copy from spec>" })).toBeVisible();
    await shot(1);
  });

  await test.step("2. <next action>", async () => {
    // A failed ACTION (click timeout) still ends the test: steps that depend on it are BLOCKED.
    await shot(2);
  });
});
```

## Config — `_local/scripts/manual.config.ts`

A dedicated config so the run (a) skips the repo's `globalSetup` (which forces an unnecessary
login) and (b) carries whatever bot-protection `userAgent`/header your infra needs.

```ts
import { defineConfig, devices } from "@playwright/test";
// import "dotenv/config"; // uncomment if your project loads env (e.g. a WAF token) from .env

export default defineConfig({
  testDir: "./",
  // Relative to this file: keeps Playwright's failure artifacts inside the scratch root
  // (_local/test-results), never next to a symlinked node_modules or in the user's home folder.
  outputDir: "../test-results",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["line"]],
  // A locator that matches nothing is INFORMATION, not a reason to hang the run. Without
  // actionTimeout an action inherits the test timeout (tens of minutes) and leaves a frozen
  // browser window on the user's screen.
  use: { screenshot: "on", trace: "off", actionTimeout: 12_000, navigationTimeout: 30_000 },
  expect: { timeout: 10_000 },
  projects: [{
    name: "chromium",
    use: {
      ...devices["Desktop Chrome"],
      // Behind a bot-protection/WAF layer? Add the required userAgent/header here, sourcing any
      // token from env — never hard-code it. A silent challenge page looks like "login failed".
      // userAgent: `Mozilla/5.0 (...) Chrome/131.0.0.0 Safari/537.36 YourE2E/${process.env.YOUR_WAF_TOKEN ?? ""}`,
      launchOptions: { headless: false },
    },
    timeout: 45 * 60 * 1000,
  }],
});
```

Run with:

```bash
npx playwright test -c _local/scripts/manual.config.ts _manual-<slug>
```

Forgetting `-c` pulls in the project's `globalSetup` (slow, fails on stale fixtures) and skips the
bot-protection settings. Long runs: start in the background and watch the log; never block the
conversation on them.

## Network capture: blocklist, never allowlist

Filtering by your app's host blinds you to every call to another host — a separate API domain,
third parties — and turns "no request fired" into an unfounded conclusion. Capture everything and
drop only known noise:

```ts
const NOISE = /(analytics|googletagmanager|google-analytics|sentry|fonts\.|\.(png|jpe?g|svg|woff2?|css|js)(\?|$))/i;
const requests: string[] = [];
page.on("request", r => { if (!NOISE.test(r.url())) requests.push(`${r.method()} ${r.url()}`); });
page.on("response", async r => { if (!NOISE.test(r.url())) console.log(`  <- ${r.status()} ${r.url()}`); });
```

Extend `NOISE` with your own vendors (bot protection, payments, product analytics).

## Playwright best practices

- **Locator priority:** `getByRole` → `getByLabel` / `getByPlaceholder` → `getByText` →
  `getByTestId` → CSS/XPath (last resort). `getByText` is fine when the assertion *is* about
  verbatim copy being visible. Take role and accessible name from the recon snapshot when you
  have one (`recon.md`), not from a guess.
- **Reuse the project's page objects first** — they are maintained and shared with the committed suite.
- **Web-first assertions** (`toBeVisible`, `toHaveText`, `toHaveURL`, …) over truthiness checks.
- **No hard waits:** never `page.waitForTimeout(...)`. Assert on observable state — an arbitrary
  wait can also mask a real app bug.
- **Reuse `storageState`:** never script the login UI inside a scenario.
- **One `test()` for a sequential plan, `expect.soft` for each step's result.** Steps that build
  on each other share page state. Split across several tests, that state does not survive a failure:
  Playwright restarts the worker after a failed test (re-running `beforeAll`), so the next step starts
  from a fresh page — and the reset then looks like an app bug ("the panel closed by itself"). Put the
  plan in one test, one `test.step()` per step, and assert each step's **result** with
  `expect.soft(...)` so a failed expectation is recorded without hiding the steps after it. A failed
  **action** (a click that times out) still ends the test: mark the steps that depended on it
  `BLOCKED`, and give steps that do not depend on it a test of their own (with their own setup).
- **Tall pages: add a focused screenshot.** A full-page screenshot of a long list can be thousands of
  pixels tall and unreadable once scaled. Keep the full-page shot when the claim is about the whole
  page ("no modal appeared"), and add a screenshot of the region the step asserts on
  (`locator.screenshot()` or the viewport after `scrollIntoViewIfNeeded()`).
- **Short action timeouts, always.** If a run dies, close the browser context before reporting —
  the user is looking at the screen.

## Interaction workarounds — forbidden

Each of these makes an interaction "succeed" where a user's would not, which turns a real bug
(an overlay covering the button, a control that is not clickable, a hidden element) into a `PASS`:

- `click({ force: true })` — skips the actionability checks a real click must pass.
- Clicking through script: `locator.evaluate(el => el.click())`, `dispatchEvent("click")`,
  `page.evaluate(() => document.querySelector(…).click())`.
- Clicking by coordinates (`page.mouse.click(x, y)`) to reach an element you could not locate.
- Removing or hiding nodes to clear the way (`el.remove()`, `style.display = "none"`) — except the
  overlays the brief explicitly lists as known noise, dismissed the way a user would (their close
  button) or by the project's own helper for that overlay.
- Falling back to another locator inside a `try/catch` (or `.or()`) when the first one fails to
  reach an AC target.

If an interaction only works through one of these, the interaction **failed**: record what blocked
it (screenshot of the covering element, the actionability error) as the step's observation.

## Strict mode, ambiguity and scoping

A locator that matches several elements throws in strict mode. That error is information — the
page has more than one candidate — not something to silence:

- **Scope it** to the region the step is about: `page.getByRole("dialog").getByRole("button", { name: "Save" })`,
  `page.getByRole("row", { name: /Jane Doe/ }).getByRole("button", { name: "Edit" })`,
  `locator.filter({ hasText: "…" })`.
- `.first()` / `.nth(i)` / `.last()` only when the position **is** the thing under test ("the first
  result is the cheapest") — say so in a comment next to it.

## Structure assertions with `toMatchAriaSnapshot`

When an AC is about structure — the items of a menu, the order of a list, the fields of a form —
`expect(locator).toMatchAriaSnapshot(template)` asserts it in one step (Playwright ≥ 1.49):

```ts
// Template written FROM THE AC, never pasted from a recon file or from the screen.
await expect(page.getByRole("menu", { name: "Sort by" })).toMatchAriaSnapshot(`
  - menuitem "Price: low to high"
  - menuitem "Price: high to low"
  - menuitem "Newest"
`);
```

Matching is **partial**: extra items on the page pass, and so do children the template does not
list. If the AC says "only these three options", also assert the count (`toHaveCount(3)` on the
items) or add `- /children: equal` to the template (Playwright ≥ 1.52). Never generate the template from what the page shows — that
asserts today's state, bug included.

## Missing accessible names

An interactive element with no accessible name (an icon button without `aria-label`, an unlabelled
input) cannot be reached with `getByRole`/`getByLabel`. Reach it with the next locator in the
priority list, and record it as an observation of kind `a11y` in the report — never silently. It is
`non-blocking (Low)` by default under the severity gate unless the ticket is about accessibility.
