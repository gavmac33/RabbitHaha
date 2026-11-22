// Loads the real extension into Chromium and checks address-bar redirects end to end.
// Network is stubbed, so this runs offline. Needs: npx playwright install chromium
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";

const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let ctx, id;

before(async () => {
  ctx = await chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium", // full Chromium build: the headless shell can't load extensions
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`]
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent("serviceworker");
  id = new URL(sw.url()).host;
  await ctx.route(/^https?:/, r => r.fulfill({ status: 200, contentType: "text/html", body: "ok" }));
  await new Promise(res => setTimeout(res, 1000)); // let install-time work settle
});

after(async () => { await ctx?.close(); });

// What Chrome does when you type into the address bar with Google as the default engine.
async function typeInAddressBar(q) {
  const page = await ctx.newPage();
  await page.goto(`https://www.google.com/search?q=${encodeURIComponent(q)}&sourceid=chrome`).catch(() => {});
  // The redirect aborts the Google navigation (page briefly shows about:blank), so poll rather than
  // use waitForURL, which bails out on the aborted navigation. A non-command just stays on Google.
  const settled = u => u !== "about:blank" && !u.startsWith("https://www.google.com/search");
  for (let i = 0; i < 25 && !settled(page.url()); i++) await page.waitForTimeout(100);
  if (!settled(page.url())) await page.waitForTimeout(500);
  const url = page.url();
  await page.close();
  return url;
}

const cases = [
  ["gm citibike", "https://mail.google.com/mail/u/0/#search/citibike"],
  ["gh react", "https://github.com/search?q=react"],
  ["ghpr facebook/react 123", "https://github.com/facebook/react/pull/123"],
  ["cal 2026-12-25", "https://calendar.google.com/calendar/r/day/2026/12/25"],
  ["tr es hola", "https://translate.google.com/?sl=auto&tl=es&text=hola&op=translate"]
];

for (const [q, expected] of cases) {
  test(`"${q}" redirects`, async () => assert.equal(await typeInAddressBar(q), expected));
}

for (const w of ["rabbit", "b"]) {
  test(`"${w}" opens the command list`, async () => {
    assert.equal(await typeInAddressBar(w), `chrome-extension://${id}/options.html`);
  });
}

test("non-commands stay on Google", async () => {
  assert.match(await typeInAddressBar("what is rust"), /^https:\/\/www\.google\.com\/search\?q=what%20is%20rust/);
});

test("a throwing code command opens the editor with the error", async () => {
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.evaluate(async () => {
    const L = await import("./lib.js");
    const c = await L.loadCommands();
    c.push({ key: "boom", name: "boom", url: "", search: "", code: "throw new Error('bad id ' + args[0])" });
    await L.saveCommands(c);
  });
  await page.close();
  const url = await typeInAddressBar("boom 42");
  assert.match(decodeURIComponent(url), /options\.html#error=boom:\+bad\+id\+42/);
});

test("options page renders and the code editor runs snippets", async () => {
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`chrome-extension://${id}/options.html`);
  await page.fill("#filter", "ghpr");
  await page.click("td.actions button.icon.on");
  await page.fill("tr.code-row input", "facebook/react 7");
  await page.click("tr.code-row button");
  await page.waitForFunction(() => document.querySelector("pre.out")?.textContent.startsWith("https"));
  assert.equal(await page.textContent("pre.out"), "https://github.com/facebook/react/pull/7");
  assert.deepEqual(errors, []);
  await page.close();
});
