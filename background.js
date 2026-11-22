import { loadCommands, loadSettings, saveCommands, resolve, parse, keysOf, upsert, toUrls } from "./lib.js";

let cache = null;
async function state() {
  if (!cache) cache = { commands: await loadCommands(), settings: await loadSettings() };
  return cache;
}
chrome.storage.onChanged.addListener(() => { cache = null; });

const HELP_URL = () => chrome.runtime.getURL("options.html");

async function open(url, disposition, tabId) {
  if (disposition === "newForegroundTab") return chrome.tabs.create({ url });
  if (disposition === "newBackgroundTab") return chrome.tabs.create({ url, active: false });
  if (tabId != null) return chrome.tabs.update(tabId, { url });
  return chrome.tabs.update({ url });
}

// ---- Code commands: run in sandbox.html via an offscreen document ----

let creating = null;
async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creating ??= chrome.offscreen.createDocument({
    url: "offscreen.html",
    reasons: ["IFRAME_SCRIPTING"],
    justification: "Run user-defined Rabbit commands in a sandboxed iframe"
  }).catch(e => { if (!/single offscreen/i.test(e.message)) throw e; })
    .finally(() => { creating = null; });
  await creating;
}

async function runCode(code, arg) {
  await ensureOffscreen();
  const res = await chrome.runtime.sendMessage({ target: "rabbit-offscreen", code, arg });
  if (!res) throw new Error("sandbox didn't respond");
  if (res.error) throw new Error(res.error);
  const urls = toUrls(res.result);
  if (!urls.length) throw new Error("code returned no URL");
  return urls;
}

// Act on a resolved input. Returns false if nothing should happen (unknown command, interception path).
async function act(r, { disposition, tabId, allowFallback }) {
  if (!r) return false;
  if (r.type === "help") { await open(HELP_URL(), disposition, tabId); return true; }
  if (r.type === "add") {
    const { commands } = await state();
    await saveCommands(upsert(commands, r.command));
    await open(HELP_URL() + "#added=" + encodeURIComponent(keysOf(r.command)[0]), disposition, tabId);
    return true;
  }
  if (r.type === "code") {
    try {
      const [first, ...rest] = await runCode(r.code, r.arg);
      await open(first, disposition, tabId);
      for (const url of rest) await chrome.tabs.create({ url, active: false });
    } catch (e) {
      const h = new URLSearchParams({ error: `${r.key}: ${e.message}`, filter: r.key });
      await open(HELP_URL() + "#" + h, disposition, tabId);
    }
    return true;
  }
  if (r.type === "url") { await open(r.url, disposition, tabId); return true; }
  if (r.type === "fallback" && allowFallback) { await open(r.url, disposition, tabId); return true; }
  return false;
}

// ---- Path 1: the "b" keyword (type `b`, then space/tab, then a command) ----

const esc = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

chrome.omnibox.setDefaultSuggestion({ description: "Rabbit: type a command, or <match>help</match> to list them" });

chrome.omnibox.onInputChanged.addListener(async (text, suggest) => {
  const { commands } = await state();
  const { cmd, arg } = parse(text);
  const matches = commands
    .map(c => ({ c, key: keysOf(c).find(k => k.startsWith(cmd)) }))
    .filter(m => m.key)
    .sort((a, b) => (a.key === cmd ? -1 : b.key === cmd ? 1 : a.key.localeCompare(b.key)))
    .slice(0, 8);
  suggest(matches.map(({ c, key }) => ({
    content: arg ? `${key} ${arg}` : key,
    description: `<match>${esc(key)}</match> ${esc(c.name || "")} <dim>${esc(c.code ? "ƒ code" : arg && c.search ? c.search : c.url || "")}</dim>`
  })));
});

chrome.omnibox.onInputEntered.addListener(async (text, disposition) => {
  const { commands, settings } = await state();
  await act(resolve(commands, settings, text), { disposition, allowFallback: true });
});

// ---- Path 2: plain address-bar searches (no keyword needed) ----
// When you type "gh react" in the address bar, Chrome sends it to Google with sourceid=chrome.
// If the first word is one of your commands we redirect; otherwise Google proceeds untouched.

chrome.webNavigation.onBeforeNavigate.addListener(async d => {
  if (d.frameId !== 0) return;
  const u = new URL(d.url);
  if (u.searchParams.get("sourceid") !== "chrome") return; // only searches typed into the address bar
  const q = u.searchParams.get("q");
  if (!q) return;
  const { commands, settings } = await state();
  if (!settings.interceptGoogle) return;
  await act(resolve(commands, settings, q), { tabId: d.tabId, allowFallback: false });
}, { url: [{ hostSuffix: "google.com", pathEquals: "/search" }] });

// First install: open the command list so it's obvious what's available.
chrome.runtime.onInstalled.addListener(({ reason }) => {
  if (reason === "install") chrome.tabs.create({ url: HELP_URL() });
});
