const count = document.querySelector("#count");
const empty = document.querySelector("#empty");
const notice = document.querySelector("#notice");
const list = document.querySelector("#sources");
const rescan = document.querySelector("#rescan");
const directFormats = new Set(["MP4", "WebM", "MOV", "OGV"]);
let tabId;
let lastItems;

function tell(text) {
  notice.textContent = text;
  notice.hidden = !text;
}

function makeItem(item, index) {
  const row = document.createElement("li");
  const details = document.createElement("div");
  const title = document.createElement("strong");
  const meta = document.createElement("p");
  const button = document.createElement("button");
  const direct = directFormats.has(item.format);
  const stream = item.format === "HLS" || item.format === "DASH";
  title.textContent = `${index + 1}. ${item.format}${stream ? " 串流" : ""}`;
  meta.textContent = `${item.host} · ${item.foundIn}`;
  meta.className = "meta";
  button.type = "button";
  button.textContent = direct ? "下載" : "複製網址";
  if (direct) button.className = "download";
  button.addEventListener("click", async () => {
    button.disabled = true;
    try {
      if (direct) {
        await chrome.downloads.download({ url: item.url, saveAs: true });
        tell("已交由 Chrome 處理下載。");
      } else {
        await navigator.clipboard.writeText(item.url);
        tell("已複製影片來源網址。");
      }
    } catch {
      tell(direct ? "Chrome 未能開始下載。" : "未能將網址寫入剪貼簿。");
    } finally {
      button.disabled = false;
    }
  });
  details.append(title, meta);
  row.append(details, button);
  return row;
}

function render(state) {
  const items = state.sources;
  count.textContent = `找到 ${items.length} 筆影片來源`;
  empty.hidden = !!items.length;
  const fingerprint = JSON.stringify(items);
  if (fingerprint !== lastItems) {
    lastItems = fingerprint;
    list.replaceChildren(...items.map(makeItem));
  }
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
    list.replaceChildren();
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
