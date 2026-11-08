import { makeHlsPreview } from "./hls-preview.js";
import { language, setLanguage, t } from "./i18n.js";
import { allowMediaHost, mediaUrl } from "./media-access.js";

const count = document.querySelector("#count");
const empty = document.querySelector("#empty");
const notice = document.querySelector("#notice");
const list = document.querySelector("#sources");
const rescan = document.querySelector("#rescan");
const languageSelect = document.querySelector("#language");
const directFormats = new Set(["MP4", "WebM", "MOV", "OGV"]);
const rows = new Map();
let tabId;
let pageOrigin;
let pageMessage = "readingTab";
let noticeMessage = "";
let currentState;
let downloadJobs = new Map();

function tell(message) {
  noticeMessage = message;
  notice.textContent = message ? t(message) : "";
  notice.hidden = !message;
}

function action(label, handler, error, primary = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.message = label;
  button.textContent = t(label);
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
      suggestedName: (name || t("videoFilename")) + ".mp4",
      types: [{ description: t("mp4Video"), accept: { "video/mp4": [".mp4"] } }],
    });
    ready = chrome.runtime.sendMessage({ type: "prepare-hls-download" }).catch(() => false);
    handle = await selection;
  } catch (error) {
    if (error.name === "AbortError") return "savePickerCancelled";
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
  if (preview) element.append(preview.element);
  if (directFormats.has(item.format)) {
    actions.append(action("download", async () => {
      await chrome.downloads.download({ url: item.url, saveAs: true });
      return "chromeDownloadStarted";
    }, "chromeDownloadFailed", true));
  } else {
    actions.append(action("copyUrl", async () => {
      await navigator.clipboard.writeText(item.url);
      return "copiedUrl";
    }, "copyFailed"));
  }
  details.append(title, meta);
  info.append(details, actions);
  element.append(info);
  if (!hls) return { element, title, meta, preview };

  let blockedHost;
  const progress = document.createElement("p");
  progress.className = "job-status";
  progress.setAttribute("role", "status");
  progress.hidden = true;
  const download = action("download", () => saveHls(item.url, title.textContent), "downloadStartFailed", true);
  const cancel = action("cancelDownload", async () => {
    await chrome.runtime.sendMessage({ type: "cancel-hls-download", url: item.url });
    return "";
  }, "cancelFailed");
  const allow = action("allowSource", async () => {
    if (await allowMediaHost(mediaUrl(blockedHost))) {
      return "sourceAllowed";
    }
    return "sourceNotAllowed";
  }, "permissionFailed");
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
    const text = job ? t(job.message, ...(job.values || [])) : "";
    if (progress.textContent !== text) progress.textContent = text;
  }

  return { element, title, meta, preview, showDownload };
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
  for (const item of items) {
    const key = itemKey(item);
    const row = rows.get(key) || makeItem(item);
    rows.set(key, row);
    const title = item.title || t("untitledVideo");
    if (row.title.textContent !== title) row.title.textContent = title;
    let format = item.format;
    if (format === "HLS" || format === "DASH") format = t("streamFormat", format);
    if (format === "video") format = t("unknownFormat");
    const meta = [format, item.host, t(item.foundIn)].join(" · ");
    if (row.meta.textContent !== meta) row.meta.textContent = meta;
    row.showDownload?.(downloadJobs.get(item.url));
    if (row.element !== next) list.insertBefore(row.element, next);
    next = row.element.nextElementSibling;
  }
}

function render() {
  const items = currentState?.sources || [];
  count.textContent = pageMessage ? t(pageMessage) : t("sourceCount", items.length);
  empty.hidden = !!pageMessage || !!items.length;
  renderSources(items);
}

async function showState(state) {
  const jobs = await chrome.runtime.sendMessage({ type: "read-hls-downloads" }).catch(() => []);
  currentState = state;
  downloadJobs = new Map(jobs || []);
  pageMessage = "";
  render();
}

function showPageMessage(message) {
  currentState = null;
  pageMessage = message;
  render();
}

function applyLanguage(value) {
  setLanguage(value);
  document.documentElement.lang = language;
  document.title = t("appName");
  languageSelect.value = language;
  list.setAttribute("aria-label", t("videoSources"));
  for (const element of document.querySelectorAll("[data-message]")) {
    element.textContent = t(element.dataset.message);
  }
  for (const row of rows.values()) row.preview?.localize();
  tell(noticeMessage);
  render();
}

function read(type = "read-videos") {
  return chrome.tabs.sendMessage(tabId, { type }, { frameId: 0 });
}

async function refresh() {
  try {
    await showState(await read());
  } catch {
    showPageMessage("tabChanged");
    tell("reopenPopup");
    rescan.disabled = true;
    return;
  }
  setTimeout(refresh, 900);
}

rescan.addEventListener("click", async () => {
  tell("");
  try {
    await showState(await read("rescan-videos"));
  } catch {
    tell("rescanFailed");
  }
});

languageSelect.addEventListener("change", async () => {
  const previous = language;
  languageSelect.disabled = true;
  applyLanguage(languageSelect.value);
  try {
    await chrome.storage.local.set({ language });
  } catch {
    applyLanguage(previous);
    tell("languageSaveFailed");
  } finally {
    languageSelect.disabled = false;
  }
});

async function open() {
  const preference = await chrome.storage.local.get("language").catch(() => ({}));
  applyLanguage(preference.language);
  languageSelect.disabled = false;
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:\/\//i.test(tab.url || "")) {
      showPageMessage("openWebsite");
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
    await showState(state);
    setTimeout(refresh, 900);
  } catch {
    showPageMessage("cannotScan");
    tell("checkAccess");
  }
}

open();

