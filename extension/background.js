function setBadge(tabId, count) {
  const text = count > 99 ? "99+" : count ? String(count) : "";
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "video-count" && sender.tab && sender.frameId === 0) {
    setBadge(sender.tab.id, message.count);
  }
});

chrome.tabs.onUpdated.addListener((tabId, changes) => {
  if (changes.status === "loading") {
    setBadge(tabId, 0);
  }
});
