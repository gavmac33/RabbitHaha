import { loadCommands, saveCommands, upsert, keysOf, findCommand, RESERVED } from "./lib.js";

const $ = id => document.getElementById(id);

const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
if (tab?.url) $("url").value = tab.url;
if (tab?.title) $("name").value = tab.title;

$("form").addEventListener("submit", async e => {
  e.preventDefault();
  const command = {
    key: $("key").value.trim(),
    name: $("name").value.trim(),
    url: $("url").value.trim(),
    search: $("search").value.trim()
  };
  const keys = keysOf(command);
  const bad = keys.find(k => /\s/.test(k) || RESERVED.includes(k));
  if (!keys.length || bad) { $("msg").textContent = bad ? `"${bad}" isn't allowed.` : "Add an alias."; return; }

  const commands = await loadCommands();
  const clash = keys.map(k => findCommand(commands, k)).find(Boolean);
  if (clash && !confirm(`Replace existing "${clash.key}" (${clash.name})?`)) return;

  await saveCommands(upsert(commands, command));
  $("msg").textContent = `Saved — type "${keys[0]}" in the address bar.`;
  setTimeout(() => window.close(), 900);
});
