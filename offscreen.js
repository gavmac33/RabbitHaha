// Service workers can't host iframes, so this offscreen document relays code to the sandbox.
import { runInSandbox } from "./sandbox-client.js";

chrome.runtime.onMessage.addListener((msg, _sender, send) => {
  if (msg?.target !== "rabbit-offscreen") return;
  runInSandbox(msg.code, msg.arg).then(send);
  return true; // async response
});
