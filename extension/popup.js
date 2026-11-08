import { makeHlsPreview } from "./hls-preview.js";
import { allowMediaHost, mediaUrl } from "./media-access.js";

const count = document.querySelector("#count");
const empty = document.querySelector("#empty");
const notice = document.querySelector("#notice");
const list = document.querySelector("#sources");
const rescan = document.querySelector("#rescan");
const directFormats = new Set(["MP4", "WebM", "MOV", "OGV"]);
const rows = new Map();
let tabId;
let pageOrigin;

function tell(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

function action(label, handler, error, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  if (primary) button.className = "download";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      tell(await handler());
    } catch {
      tell(error);
    } finally {
      button.disabled = false;
    }
  });
  return button;
}

async function saveHls(url, title) {
  const name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").trim().replace(/[. ]+$/, "");
  let handle;
  let ready;
  try {
    const selection = showSaveFilePicker({
      suggestedName: (name || "影片") + ".mp4",
      types: [{ description: "MP4 影片", accept: { "video/mp4": [".mp4"] } }],
    });
    ready = chrome.runtime.sendMessage({ type: "prepare-hls-download" }).catch(() => false);
    handle = await selection;
  } catch (error) {
    if (error.name === "AbortError") return "已取消選擇儲存位置。";
    throw error;
  }
  if (!await ready) throw new Error("Download worker unavailable");
  const channel = new BroadcastChannel("hls-downloads");
  try {
    channel.postMessage({ url, pageOrigin, handle });
  } finally {
    channel.close();
  }
  return "";
}

function makeItem(item) {
  const element = document.createElement("li");
  const info = document.createElement("div");
  const details = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("p");
  const actions = document.createElement("div");
  const hls = item.format === "HLS";
  const preview = hls ? makeHlsPreview(item.url, pageOrigin) : null;
  info.className = "source-info";
  actions.className = "actions";
  meta.className = "meta";
  const format = hls || item.format === "DASH" ? item.format + " 串流" : item.format;
  meta.textContent = [format, item.host, item.foundIn].join(" · ");
  if (preview) element.append(preview.element);
  if (directFormats.has(item.format)) {
    actions.append(action("下載", async () => {
      await chrome.downloads.download({ url: item.url, saveAs: true });
      return "已交由 Chrome 處理下載。";
    }, "Chrome 未能開始下載。", true));
  } else {
    actions.append(action("複製網址", async () => {
      await navigator.clipboard.writeText(item.url);
      return "已複製影片來源網址。";
    }, "未能將網址寫入剪貼簿。"));
  }
  details.append(title, meta);
  info.append(details, actions);
  element.append(info);
  if (!hls) return { element, title, preview };

  let blockedHost;
  const progress = document.createElement("p");
  progress.className = "job-status";
  progress.setAttribute("role", "status");
  progress.hidden = true;
  const download = action("下載", () => saveHls(item.url, title.textContent), "未能開始下載。", true);
  const cancel = action("取消下載", async () => {
    await chrome.runtime.sendMessage({ type: "cancel-hls-download", url: item.url });
    return "";
  }, "未能取消下載。");
  const allow = action("允許影片來源", async () => {
    if (await allowMediaHost(mediaUrl(blockedHost))) {
      return "已允許影片來源，請再次按下載。";
    }
    return "影片來源尚未獲得允許。";
  }, "未能取得影片來源的權限。");
  cancel.hidden = true;
  allow.hidden = true;
  actions.append(download, cancel);
  element.append(progress, allow);

  function showDownload(job) {
    blockedHost = job?.blockedHost;
    const running = job?.status === "running";
    download.hidden = running;
    cancel.hidden = !running;
    allow.hidden = !blockedHost;
    progress.hidden = !job;
    if (job && progress.textContent !== job.text) progress.textContent = job.text;
  }

  return { element, title, preview, showDownload };
}

function itemKey(item) {
  return `${item.format} ${item.url}`;
}

function renderSources(items, jobs = new Map()) {
  const visible = new Set(items.map(itemKey));
  for (const [key, row] of rows) {
    if (visible.has(key)) continue;
    row.preview?.stop();
    row.element.remove();
    rows.delete(key);
  }
  let next = list.firstElementChild;
  for (const item of items) {
    const key = itemKey(item);
    const row = rows.get(key) || makeItem(item);
    rows.set(key, row);
    const title = item.title || "未命名影片";
    if (row.title.textContent !== title) row.title.textContent = title;
    row.showDownload?.(jobs.get(item.url));
    if (row.element !== next) list.insertBefore(row.element, next);
    next = row.element.nextElementSibling;
  }
}

async function render(state) {
  const items = state.sources;
  count.textContent = `找到 ${items.length} 筆影片來源`;
  empty.hidden = !!items.length;
  const jobs = await chrome.runtime.sendMessage({ type: "read-hls-downloads" }).catch(() => []);
  renderSources(items, new Map(jobs || []));
}

function read(type = "read-videos") {
  return chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 });
}

async function refresh() {
  try {
    await render(await read());
  } catch {
    count.textContent = "分頁已變更";
    tell("請重新開啟擴充功能以掃描目前的頁面。");
    renderSources([]);
    empty.hidden = true;
    rescan.disabled = true;
    return;
  }
  setTimeout(refresh, 900);
}

rescan.addEventListener("click", async () => {
  tell("");
  try {
    await render(await read("rescan-videos"));
  } catch {
    tell("目前無法掃描此分頁。");
  }
});

async function open() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
      count.textContent = "請先開啟一般網站";
      return;
    }
    tabId = tab.id;
    pageOrigin = new URL(tab.url).origin;
    let state;
    try {
      state = await read();
    } catch {
      await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
      state = await read();
    }
    rescan.disabled = false;
    await render(state);
    setTimeout(refresh, 900);
  } catch {
    count.textContent = "無法掃描此頁面";
    tell("請確認網站存取權限，或重新整理此分頁。");
  }
}

open();

