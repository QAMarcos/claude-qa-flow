# Playwright templates for throwaway runs

Everything here is written under the git-ignored scratch root (default `_local/`):

```
_local/
├─ scripts/          throwaway spec + config
├─ evidence/<slug>/  screenshots, video, trace
└─ logs/             run output
```

Never put these files in the committed suite folder or in the repo root.

## Spec — `_local/scripts/_manual-<slug>.spec.ts`

```ts
import { test, expect } from "@playwright/test";
// If the project has page objects / action helpers for this flow, import and prefer them.

// Reuse the project's stored auth so login is free.
test.use({ storageState: "./playwright/fixtures/loginAuth.json" });

test("manual: <one-line description>", async ({ page }) => {
  await page.goto("https://staging.<your-app>.example.com/<entry-point>");

  // Dismiss any onboarding / marketing overlay your app shows after navigation — after EVERY
  // goto/reload that can trigger it. Otherwise it covers the page and ruins the evidence.

  // Step 1: <action> — prefer an existing helper; otherwise role/label-based locators.
  await page.getByRole("button", { name: "<accessible name>" }).click();

  // Assert the observable expected result with a web-first (auto-retrying) assertion.
  await expect(page.getByRole("heading", { name: "<verbatim copy from spec>" })).toBeVisible();

  await page.screenshot({ path: `_local/evidence/<slug>/step-1-${Date.now()}.png`, fullPage: true });
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
  verbatim copy being visible.
- **Reuse the project's page objects first** — they are maintained and shared with the committed suite.
- **Web-first assertions** (`toBeVisible`, `toHaveText`, `toHaveURL`, …) over truthiness checks.
- **No hard waits:** never `page.waitForTimeout(...)`. Assert on observable state — an arbitrary
  wait can also mask a real app bug.
- **Reuse `storageState`:** never script the login UI inside a scenario.
- **Short action timeouts, always.** If a run dies, close the browser context before reporting —
  the user is looking at the screen.
