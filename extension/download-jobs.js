const channel = new BroadcastChannel("hls-downloads");
const active = new Map();
const states = new Map();

function remember(url, state) {
  states.delete(url);
  states.set(url, state);
  if (states.size <= active.size + 24) return;
  for (const key of states.keys()) {
    if (active.has(key)) continue;
    states.delete(key);
    break;
  }
}

channel.addEventListener("message", ({ data }) => {
  if (active.has(data.url)) return;
  const worker = new Worker("download.js", { type: "module" });
  active.set(data.url, worker);
  remember(data.url, { status: "running", message: "preparingDownload" });

  function report(state) {
    if (state.status !== "running") {
      active.delete(data.url);
      worker.terminate();
    }
    remember(data.url, state);
  }

  worker.addEventListener("message", ({ data: state }) => report(state));
  worker.addEventListener("error", () => report({ status: "error", message: "downloadStartFailed" }));
  worker.postMessage(data);
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "read-hls-downloads") {
    sendResponse(Array.from(states));
  } else if (message?.type === "cancel-hls-download") {
    active.get(message.url)?.postMessage({ type: "cancel" });
    sendResponse(true);
  }
});
