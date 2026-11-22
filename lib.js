// Shared logic: storage, parsing, resolving commands.
//
// A command looks like:
//   { key: "gh,github", name: "GitHub", url: "https://github.com", search: "https://github.com/search?q=%s" }
// - key:    one or more comma-separated aliases
// - url:    where to go when the command is typed with no argument
// - search: template used when an argument follows the command (optional)
//           %s = URL-encoded argument, %S = raw argument (good for paths, e.g. github.com/%S)
// - code:   optional JS function body; when set it overrides url/search. Runs in a sandbox with
//           `args` (array), `q` (raw string after the command), `enc` (encodeURIComponent).
//           Returns a URL or an array of URLs (opens several tabs). `await` is allowed.

// Typed alone, any of these opens the command list. With words after them they're ordinary
// input, so "rabbit hole" is still a Google search.
export const HELP_WORDS = ["help", "list", "?", "b", "rabbit", "bunny", "rh"];
export const RESERVED = [...HELP_WORDS, "add"];

export const DEFAULT_SETTINGS = {
  fallback: "https://www.google.com/search?q=%s", // used by the "b" keyword when nothing matches
  interceptGoogle: true // catch address-bar searches that start with a command
};

export const DEFAULT_COMMANDS = [
  { key: "g", name: "Google", url: "https://www.google.com", search: "https://www.google.com/search?q=%s" },
  { key: "gh", name: "GitHub search", url: "https://github.com", search: "https://github.com/search?q=%s" },
  { key: "ghr", name: "GitHub repo/path", url: "https://github.com", search: "https://github.com/%S" },
  { key: "yt", name: "YouTube", url: "https://www.youtube.com", search: "https://www.youtube.com/results?search_query=%s" },
  { key: "gm,mail", name: "Gmail", url: "https://mail.google.com", search: "https://mail.google.com/mail/u/0/#search/%s" },
  {
    key: "cal", name: "Google Calendar (cal, cal tomorrow, cal +3, cal 2026-12-25, cal <search>)",
    url: "https://calendar.google.com",
    code: [
      "const a = (args[0] || '').toLowerCase();",
      "if (!a) return 'https://calendar.google.com';",
      "const d = new Date();",
      "if (a === 'tomorrow' || a === 'tmr') d.setDate(d.getDate() + 1);",
      "else if (/^[+-]\\d+$/.test(a)) d.setDate(d.getDate() + Number(a));",
      "else if (/^\\d{4}-\\d{2}-\\d{2}$/.test(a)) { const [y, m, dd] = a.split('-').map(Number); d.setFullYear(y, m - 1, dd); }",
      "else return 'https://calendar.google.com/calendar/r/search?q=' + enc(q);",
      "return `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;"
    ].join("\n")
  },
  {
    key: "ghpr", name: "GitHub PRs (ghpr, ghpr owner/repo, ghpr owner/repo 123)",
    code: [
      "const [repo, n] = args;",
      "if (!repo) return 'https://github.com/pulls';",
      "return n ? `https://github.com/${repo}/pull/${n}` : `https://github.com/${repo}/pulls`;"
    ].join("\n")
  },
  {
    key: "tr", name: "Translate (tr es good morning)",
    code: [
      "const [to = 'en', ...rest] = args;",
      "return `https://translate.google.com/?sl=auto&tl=${enc(to)}&text=${enc(rest.join(' '))}&op=translate`;"
    ].join("\n")
  },
  {
    key: "news", name: "Open several tabs at once",
    code: "return ['https://news.ycombinator.com', 'https://lobste.rs'];"
  },
  { key: "gd,drive", name: "Google Drive", url: "https://drive.google.com", search: "https://drive.google.com/drive/search?q=%s" },
  { key: "m,maps", name: "Google Maps", url: "https://www.google.com/maps", search: "https://www.google.com/maps/search/%s" },
  { key: "w,wiki", name: "Wikipedia", url: "https://en.wikipedia.org", search: "https://en.wikipedia.org/wiki/Special:Search?search=%s" },
  { key: "r", name: "Reddit", url: "https://www.reddit.com", search: "https://www.reddit.com/search/?q=%s" },
  { key: "so", name: "Stack Overflow", url: "https://stackoverflow.com", search: "https://stackoverflow.com/search?q=%s" },
  { key: "mdn", name: "MDN", url: "https://developer.mozilla.org", search: "https://developer.mozilla.org/en-US/search?q=%s" },
  { key: "npm", name: "npm", url: "https://www.npmjs.com", search: "https://www.npmjs.com/search?q=%s" },
  { key: "pypi", name: "PyPI", url: "https://pypi.org", search: "https://pypi.org/search/?q=%s" },
  { key: "amz", name: "Amazon", url: "https://www.amazon.com", search: "https://www.amazon.com/s?k=%s" },
  { key: "c,claude", name: "Claude", url: "https://claude.ai/new" },
  { key: "cy,chat,chatgpt", name: "ChatGPT", url: "https://chatgpt.com/" }
];

// chrome.storage.sync caps each item at 8 KB, so the command list is stored in chunks.
const CHUNK = 2000;

export async function loadCommands() {
  const { cmds_n } = await chrome.storage.sync.get("cmds_n");
  if (!cmds_n) return structuredClone(DEFAULT_COMMANDS);
  const keys = Array.from({ length: cmds_n }, (_, i) => "cmds_" + i);
  const parts = await chrome.storage.sync.get(keys);
  try {
    return JSON.parse(keys.map(k => parts[k] ?? "").join(""));
  } catch {
    return structuredClone(DEFAULT_COMMANDS);
  }
}

export async function saveCommands(commands) {
  const json = JSON.stringify(commands);
  const obj = {};
  let n = 0;
  for (let i = 0; i < json.length; i += CHUNK) obj["cmds_" + n++] = json.slice(i, i + CHUNK);
  const { cmds_n: old = 0 } = await chrome.storage.sync.get("cmds_n");
  obj.cmds_n = n;
  await chrome.storage.sync.set(obj);
  const stale = [];
  for (let i = n; i < old; i++) stale.push("cmds_" + i);
  if (stale.length) await chrome.storage.sync.remove(stale);
}

export async function loadSettings() {
  const { settings } = await chrome.storage.sync.get("settings");
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}

export async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
}

export function keysOf(c) {
  return (c.key || "").split(",").map(k => k.trim().toLowerCase()).filter(Boolean);
}

export function findCommand(commands, cmd) {
  return commands.find(c => keysOf(c).includes(cmd));
}

export function parse(input) {
  const t = (input || "").trim();
  const i = t.search(/\s/);
  if (i < 0) return { cmd: t.toLowerCase(), arg: "" };
  return { cmd: t.slice(0, i).toLowerCase(), arg: t.slice(i).trim() };
}

export function fill(template, arg) {
  return template.replace(/%[sS]/g, m => (m === "%s" ? encodeURIComponent(arg) : arg));
}

// Returns {type: "help"} | {type: "add", ...} | {type: "code", ...} | {type: "url", url} | {type: "fallback", url} | null
export function resolve(commands, settings, input) {
  const { cmd, arg } = parse(input);
  if (!cmd) return null;
  if (HELP_WORDS.includes(cmd) && !arg) return { type: "help" };
  if (cmd === "add") {
    // add <keys> <url> [search-template]
    const [key, url, search] = arg.split(/\s+/);
    if (key && url) return { type: "add", command: { key, name: key, url, search: search || "" } };
  }
  const c = findCommand(commands, cmd);
  if (c) {
    if (c.code) return { type: "code", key: cmd, code: c.code, arg };
    if (arg && c.search) return { type: "url", url: fill(c.search, arg) };
    return { type: "url", url: c.url || fill(c.search || "", "") };
  }
  return { type: "fallback", url: fill(settings.fallback, input.trim()) };
}

// Normalize what a code command returned into a list of URLs.
export function toUrls(result) {
  const list = (Array.isArray(result) ? result : [result])
    .filter(x => typeof x === "string" && x.trim())
    .map(x => x.trim());
  return list.map(u => (/^[a-z][\w+.-]*:/i.test(u) ? u : "https://" + u));
}

// Insert or replace a command (any overlapping alias is replaced).
export function upsert(commands, command) {
  const keys = keysOf(command);
  const rest = commands.filter(c => !keysOf(c).some(k => keys.includes(k)));
  return [...rest, command];
}
