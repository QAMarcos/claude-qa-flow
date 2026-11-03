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
