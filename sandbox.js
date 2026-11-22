// Runs user-defined command code. Only receives the code + args, only returns strings.
const AsyncFunction = (async () => {}).constructor;

window.addEventListener("message", async e => {
  const { id, code, arg } = e.data || {};
  if (!id) return;
  const q = (arg || "").trim();
  const args = q ? q.split(/\s+/) : [];
  let reply;
  try {
    const fn = new AsyncFunction("args", "q", "enc", `"use strict";\n${code}`);
    const result = await fn(args, q, encodeURIComponent);
    reply = { id, result: Array.isArray(result) ? result.map(String) : result == null ? null : String(result) };
  } catch (err) {
    reply = { id, error: String((err && err.message) || err) };
  }
  e.source.postMessage(reply, "*");
});
