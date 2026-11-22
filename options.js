import {
  loadCommands, saveCommands, loadSettings, saveSettings,
  DEFAULT_COMMANDS, RESERVED, keysOf, toUrls
} from "./lib.js";
import { runInSandbox } from "./sandbox-client.js";

const $ = id => document.getElementById(id);
let commands = [];
const expanded = new WeakSet(); // commands whose code editor is open

const CODE_TEMPLATE = [
  "// args = ['owner/repo', '123'], q = 'owner/repo 123', enc = encodeURIComponent",
  "const [repo, n] = args;",
  "return n ? `https://github.com/${repo}/pull/${n}` : `https://github.com/${repo}`;"
].join("\n");

function toast(msg, bad = false) {
  const t = $("toast");
  t.textContent = msg;
  t.className = bad ? "bad" : "";
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3000);
}

function markDirty() { $("dirty").hidden = false; }

function input(value, field, c, placeholder) {
  const el = document.createElement("input");
  el.value = value || "";
  el.placeholder = placeholder;
  el.addEventListener("input", () => { c[field] = el.value; markDirty(); });
  return el;
}

function button(text, title, onClick, cls = "icon") {
  const b = document.createElement("button");
  b.textContent = text;
  b.title = title;
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function setCodeMode(cells, on) {
  cells[2].disabled = cells[3].disabled = on;
  cells[2].placeholder = on ? "(runs code)" : "https://github.com";
  cells[3].placeholder = on ? "(runs code)" : "optional — e.g. …?q=%s";
}

function codeRow(c, cells) {
  const tr = document.createElement("tr");
  tr.className = "code-row";
  const td = document.createElement("td");
  td.colSpan = 5;

  const ta = document.createElement("textarea");
  ta.value = c.code || "";
  ta.spellcheck = false;
  ta.placeholder = CODE_TEMPLATE;
  ta.rows = Math.max(4, (c.code || CODE_TEMPLATE).split("\n").length + 1);
  ta.addEventListener("input", () => { c.code = ta.value; markDirty(); setCodeMode(cells, !!ta.value.trim()); });
  ta.addEventListener("keydown", e => {
    if (e.key === "Tab" && !e.shiftKey) { e.preventDefault(); ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end"); }
  });

  const argIn = document.createElement("input");
  argIn.placeholder = `test args, e.g. "${keysOf(c)[0] || "cmd"} foo bar" → foo bar`;
  const out = document.createElement("pre");
  out.className = "out";
  const run = async () => {
    out.textContent = "…";
    const r = await runInSandbox(ta.value || ta.placeholder, argIn.value);
    out.classList.toggle("bad", !!r.error);
    out.textContent = r.error ? "Error: " + r.error : toUrls(r.result).join("\n") || "(no URL returned)";
  };
  argIn.addEventListener("keydown", e => { if (e.key === "Enter") run(); });

  const bar = document.createElement("div");
  bar.className = "bar";
  bar.append(argIn, button("Run", "Run with these args", run, ""));

  const hint = document.createElement("p");
  hint.className = "hint";
  hint.innerHTML = "Function body. Gets <code>args</code> (array), <code>q</code> (everything after the command), <code>enc</code> (encodeURIComponent). " +
    "Return a URL, or an array of URLs to open several tabs. <code>await</code>/<code>fetch</code> work. Runs sandboxed: no access to your pages or Chrome APIs. " +
    "When code is set, URL and search are ignored.";

  td.append(ta, bar, out, hint);
  tr.append(td);
  return tr;
}

function render() {
  const f = $("filter").value.trim().toLowerCase();
  const body = $("rows");
  body.replaceChildren();
  commands.forEach((c, i) => {
    const hay = `${c.key} ${c.name} ${c.url} ${c.search} ${c.code || ""}`.toLowerCase();
    if (f && !hay.includes(f)) return;
    const tr = document.createElement("tr");
    const cells = [
      input(c.key, "key", c, "gh,github"),
      input(c.name, "name", c, "GitHub"),
      input(c.url, "url", c, "https://github.com"),
      input(c.search, "search", c, "optional — e.g. …?q=%s")
    ];
    cells[0].classList.add("key");
    setCodeMode(cells, !!(c.code || "").trim());
    for (const el of cells) { const td = document.createElement("td"); td.append(el); tr.append(td); }

    const actions = document.createElement("td");
    actions.className = "actions";
    const fx = button("ƒ", "Run code instead of a URL", () => {
      expanded.has(c) ? expanded.delete(c) : expanded.add(c);
      render();
    });
    if ((c.code || "").trim()) fx.classList.add("on");
    actions.append(fx, button("✕", "Delete", () => { commands.splice(i, 1); markDirty(); render(); }));
    tr.append(actions);
    body.append(tr);
    if (expanded.has(c)) body.append(codeRow(c, cells));
  });
}

function validate(list) {
  const seen = new Map();
  for (const c of list) {
    const keys = keysOf(c);
    if (!keys.length) return "Every command needs at least one alias.";
    if (!c.url && !c.search && !c.code) return `"${c.key}" needs a URL, a search template, or code.`;
    for (const k of keys) {
      if (/\s/.test(k)) return `Alias "${k}" can't contain spaces.`;
      if (RESERVED.includes(k)) return `"${k}" is reserved.`;
      if (seen.has(k)) return `Alias "${k}" is used twice.`;
      seen.set(k, true);
    }
  }
  return null;
}

async function save() {
  const cleaned = [];
  for (const c of commands) {
    const n = { key: (c.key || "").trim(), name: (c.name || "").trim(), url: (c.url || "").trim(), search: (c.search || "").trim() };
    const code = (c.code || "").replace(/\s+$/, "");
    if (code) n.code = code;
    if (!n.key && !n.url && !n.search && !n.code) continue;
    if (expanded.has(c)) expanded.add(n);
    cleaned.push(n);
  }
  const err = validate(cleaned);
  if (err) return toast(err, true);
  cleaned.sort((a, b) => a.key.localeCompare(b.key));
  await saveCommands(cleaned);
  commands = cleaned;
  $("dirty").hidden = true;
  render();
  toast("Saved");
}

async function init() {
  commands = await loadCommands();
  commands.sort((a, b) => a.key.localeCompare(b.key));
  const settings = await loadSettings();
  $("intercept").checked = settings.interceptGoogle;
  $("fallback").value = settings.fallback;

  const h = new URLSearchParams(location.hash.slice(1));
  const filter = h.get("filter") || h.get("added");
  if (filter) $("filter").value = filter;
  if (h.get("error")) {
    toast(h.get("error"), true);
    commands.filter(c => keysOf(c).includes(filter)).forEach(c => expanded.add(c));
  } else if (h.get("added")) toast(`Added "${h.get("added")}"`);
  render();
}

function addRow(withCode) {
  const c = { key: "", name: "", url: "", search: "" };
  if (withCode) { c.code = CODE_TEMPLATE; expanded.add(c); }
  commands.unshift(c);
  $("filter").value = "";
  markDirty();
  render();
  $("rows").querySelector("input")?.focus();
}

$("filter").addEventListener("input", render);
$("add").addEventListener("click", () => addRow(false));
$("addCode").addEventListener("click", () => addRow(true));
$("save").addEventListener("click", save);
document.addEventListener("keydown", e => {
  if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); save(); }
});

$("saveSettings").addEventListener("click", async () => {
  const fallback = $("fallback").value.trim();
  if (!fallback.includes("%s") && !fallback.includes("%S")) return toast("Fallback needs %s where the query goes.", true);
  await saveSettings({ interceptGoogle: $("intercept").checked, fallback });
  toast("Settings saved");
});

$("export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(commands, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "rabbit-commands.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

$("import").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error("Expected a JSON array of commands.");
    const withCode = list.filter(c => c && c.code).length;
    if (withCode && !confirm(`${withCode} imported command(s) contain code. Only import code you trust. Continue?`)) return;
    commands = list;
    await save();
  } catch (err) {
    toast("Import failed: " + err.message, true);
  } finally {
    e.target.value = "";
  }
});

$("reset").addEventListener("click", async () => {
  if (!confirm("Replace all commands with the defaults?")) return;
  commands = structuredClone(DEFAULT_COMMANDS);
  await save();
});

init();
