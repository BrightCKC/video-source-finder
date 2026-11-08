import { makeHlsPreview } from "./hls-preview.js";

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

async function openHlsDownload(url) {
  const key = `hls-${crypto.randomUUID()}`;
  await chrome.storage.session.set({ [key]: { url, pageOrigin } });
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`download.html#${key}`) });
  } catch (error) {
    await chrome.storage.session.remove(key);
    throw error;
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
  meta.textContent = `${item.host} · ${item.foundIn}`;
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
    if (hls) {
      actions.append(action("下載", () => openHlsDownload(item.url), "未能開啟下載頁。", true));
    }
  }
  details.append(title, meta);
  info.append(details, actions);
  element.append(info);
  return { element, title, preview };
}

function itemKey(item) {
  return `${item.format} ${item.url}`;
}

function renderSources(items) {
  const visible = new Set(items.map(itemKey));
  for (const [key, row] of rows) {
    if (visible.has(key)) continue;
    row.preview?.stop();
    row.element.remove();
    rows.delete(key);
  }
  let next = list.firstElementChild;
  for (const [index, item] of items.entries()) {
    const key = itemKey(item);
    const row = rows.get(key) || makeItem(item);
    rows.set(key, row);
    const stream = item.format === "HLS" || item.format === "DASH";
    const title = `${index + 1}. ${item.format}${stream ? " 串流" : ""}`;
    if (row.title.textContent !== title) row.title.textContent = title;
    if (row.element !== next) list.insertBefore(row.element, next);
    next = row.element.nextElementSibling;
  }
}

function render(state) {
  const items = state.sources;
  count.textContent = `找到 ${items.length} 筆影片來源`;
  empty.hidden = !!items.length;
  renderSources(items);
}

function read(type = "read-videos") {
  return chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 });
}

async function refresh() {
  try {
    render(await read());
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
    render(await read("rescan-videos"));
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
    render(state);
    setTimeout(refresh, 900);
  } catch {
    count.textContent = "無法掃描此頁面";
    tell("請確認網站存取權限，或重新整理此分頁。");
  }
}

open();
