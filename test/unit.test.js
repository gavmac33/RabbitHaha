import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_COMMANDS, DEFAULT_SETTINGS, parse, fill, resolve, keysOf, findCommand, upsert, toUrls
} from "../lib.js";

const C = DEFAULT_COMMANDS;
const S = DEFAULT_SETTINGS;
const r = q => resolve(C, S, q);

// Mirrors sandbox.js so code commands can be exercised without a browser.
const AsyncFunction = (async () => {}).constructor;
async function runCode(code, arg = "") {
  const q = arg.trim();
  const args = q ? q.split(/\s+/) : [];
  return toUrls(await new AsyncFunction("args", "q", "enc", `"use strict";\n${code}`)(args, q, encodeURIComponent));
}
const codeFor = key => findCommand(C, key).code;

test("parse splits command and argument, lowercasing only the command", () => {
  assert.deepEqual(parse("  GH React Hooks "), { cmd: "gh", arg: "React Hooks" });
  assert.deepEqual(parse("cal"), { cmd: "cal", arg: "" });
  assert.deepEqual(parse(""), { cmd: "", arg: "" });
});

test("fill encodes %s and leaves %S raw", () => {
  assert.equal(fill("https://x.com/?q=%s", "a b&c"), "https://x.com/?q=a%20b%26c");
  assert.equal(fill("https://github.com/%S", "facebook/react"), "https://github.com/facebook/react");
});

test("search template is used when an argument follows the command", () => {
  assert.deepEqual(r("gm citibike"), { type: "url", url: "https://mail.google.com/mail/u/0/#search/citibike" });
  assert.deepEqual(r("gh react hooks"), { type: "url", url: "https://github.com/search?q=react%20hooks" });
  assert.deepEqual(r("ghr facebook/react"), { type: "url", url: "https://github.com/facebook/react" });
});

test("bare command opens its URL; aliases and case are handled", () => {
  assert.deepEqual(r("GM"), { type: "url", url: "https://mail.google.com" });
  assert.deepEqual(r("mail"), { type: "url", url: "https://mail.google.com" });
});

test("cy, chat and chatgpt open ChatGPT", () => {
  for (const k of ["cy", "chat", "chatgpt"]) assert.deepEqual(r(k), { type: "url", url: "https://chatgpt.com/" });
});

test("g forces a Google search even when the query is itself a command", () => {
  assert.deepEqual(r("g gm"), { type: "url", url: "https://www.google.com/search?q=gm" });
});

test("unknown input falls back to Google", () => {
  assert.deepEqual(r("what is rust"), { type: "fallback", url: "https://www.google.com/search?q=what%20is%20rust" });
  assert.equal(r("   "), null);
});

test("help and add are built in", () => {
  assert.deepEqual(r("help"), { type: "help" });
  assert.deepEqual(r("?"), { type: "help" });
  for (const w of ["b", "rabbit", "Bunny", "rh"]) assert.deepEqual(r(w), { type: "help" }, w);
  assert.equal(r("rabbit hole").type, "fallback");
  assert.deepEqual(r("add hn https://news.ycombinator.com"), {
    type: "add", command: { key: "hn", name: "hn", url: "https://news.ycombinator.com", search: "" }
  });
});

test("code commands resolve to a code action", () => {
  const res = r("ghpr facebook/react 1");
  assert.equal(res.type, "code");
  assert.equal(res.arg, "facebook/react 1");
});

test("upsert replaces any command sharing an alias", () => {
  const next = upsert(C, { key: "mail,inbox", url: "https://example.com" });
  assert.equal(next.filter(c => keysOf(c).includes("gm")).length, 0);
  assert.equal(findCommand(next, "inbox").url, "https://example.com");
});

test("toUrls normalizes strings and arrays", () => {
  assert.deepEqual(toUrls("example.com"), ["https://example.com"]);
  assert.deepEqual(toUrls(["https://a.com", "", null, "b.com"]), ["https://a.com", "https://b.com"]);
  assert.deepEqual(toUrls(undefined), []);
});

test("default commands have unique aliases and a target", () => {
  const seen = new Set();
  for (const c of C) {
    assert.ok(c.url || c.search || c.code, `${c.key} has no target`);
    for (const k of keysOf(c)) { assert.ok(!seen.has(k), `duplicate alias ${k}`); seen.add(k); }
  }
});

test("ghpr code command", async () => {
  assert.deepEqual(await runCode(codeFor("ghpr")), ["https://github.com/pulls"]);
  assert.deepEqual(await runCode(codeFor("ghpr"), "facebook/react"), ["https://github.com/facebook/react/pulls"]);
  assert.deepEqual(await runCode(codeFor("ghpr"), "facebook/react 123"), ["https://github.com/facebook/react/pull/123"]);
});

test("cal code command handles relative and absolute dates", async () => {
  const day = d => `https://calendar.google.com/calendar/r/day/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const plus = n => { const d = new Date(); d.setDate(d.getDate() + n); return d; };
  assert.deepEqual(await runCode(codeFor("cal")), ["https://calendar.google.com"]);
  assert.deepEqual(await runCode(codeFor("cal"), "tomorrow"), [day(plus(1))]);
  assert.deepEqual(await runCode(codeFor("cal"), "+3"), [day(plus(3))]);
  assert.deepEqual(await runCode(codeFor("cal"), "2026-12-25"), ["https://calendar.google.com/calendar/r/day/2026/12/25"]);
  assert.deepEqual(await runCode(codeFor("cal"), "dentist appt"), ["https://calendar.google.com/calendar/r/search?q=dentist%20appt"]);
});

test("tr and news code commands", async () => {
  assert.deepEqual(await runCode(codeFor("tr"), "es good morning"),
    ["https://translate.google.com/?sl=auto&tl=es&text=good%20morning&op=translate"]);
  assert.equal((await runCode(codeFor("news"))).length, 2);
});
