// Talks to sandbox.html via a hidden iframe. Used by the offscreen document and the options page.
let frame, ready, seq = 0;
const pending = new Map();

function init() {
  if (ready) return ready;
  frame = document.createElement("iframe");
  frame.hidden = true;
  ready = new Promise(res => frame.addEventListener("load", res, { once: true }));
  window.addEventListener("message", e => {
    if (!frame || e.source !== frame.contentWindow) return;
    const { id, result, error } = e.data || {};
    const done = pending.get(id);
    if (!done) return;
    pending.delete(id);
    done({ result, error });
  });
  frame.src = "sandbox.html";
  document.body.append(frame);
  return ready;
}

export async function runInSandbox(code, arg, timeoutMs = 5000) {
  await init();
  const id = ++seq;
  return new Promise(res => {
    pending.set(id, res);
    frame.contentWindow.postMessage({ id, code, arg }, "*");
    setTimeout(() => { if (pending.delete(id)) res({ error: `timed out after ${timeoutMs / 1000}s` }); }, timeoutMs);
  });
}
