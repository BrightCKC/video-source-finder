function setBadge(tabId, count) {
  const text = count > 99 ? "99+" : count ? String(count) : "";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

let creatingDownloadPage;

async function prepareDownloads() {
  const documentUrl = chrome.runtime.getURL("download-jobs.html");
  if (creatingDownloadPage) return creatingDownloadPage;
  creatingDownloadPage = (async () => {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [documentUrl],
    });
    if (contexts.length) return;
    await chrome.offscreen.createDocument({
      url: documentUrl,
      reasons: ["WORKERS"],
      justification: "Use a worker to save a selected HLS video after the popup closes.",
    });
  })();
  try {
    await creatingDownloadPage;
  } finally {
    creatingDownloadPage = null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "video-count" && sender.tab && sender.frameId === 0) {
    setBadge(sender.tab.id, message.count);
  }
  if (message?.type === "prepare-hls-download") {
    prepareDownloads().then(() => sendResponse(true), () => sendResponse(false));
    return true;
  }
});

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status === "loading") {
    setBadge(tabId, 0);
  }
});
