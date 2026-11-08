(() => {
  if (globalThis.videoScannerLoaded) return;
  globalThis.videoScannerLoaded = true;

  const formats = {
    mp4: "MP4",
    m4v: "MP4",
    webm: "WebM",
    mov: "MOV",
    ogv: "OGV",
    m3u8: "HLS",
    mpd: "DASH",
  };
  const mimeFormats = {
    "video/mp4": "MP4",
    "video/webm": "WebM",
    "video/quicktime": "MOV",
    "video/ogg": "OGV",
    "application/vnd.apple.mpegurl": "HLS",
    "application/x-mpegurl": "HLS",
    "application/dash+xml": "DASH",
  };
  const sources = new Map();
  let scope;
  let firstResourceTime = 0;
  let queuedScan;

  function reportCount() {
    chrome.runtime.sendMessage({ type: "video-count", count: sources.size }).catch(() => {});
  }

  function addSource(value, hint, foundIn) {
    if (typeof value !== "string" || !value.trim()) return;
    let url;
    try {
      url = new URL(value, document.baseURI);
    } catch {
      return;
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    if (/\.(?:m4s|ts|cmfv|cmfa)$/i.test(url.pathname)) return;
    const extension = url.pathname.match(/\.([a-z0-9]+)$/i)?.[1].toLowerCase();
    const format = (extension && Object.hasOwn(formats, extension) && formats[extension]) || hint;
    if (!format) return;
    url.hash = "";
    const existing = sources.get(url.href);
    if (existing) {
      if (existing.format === "影片" && format !== "影片") existing.format = format;
      return;
    }
    sources.set(url.href, { url: url.href, host: url.host, format, foundIn });
    reportCount();
  }

  function syncScope() {
    const current = location.origin + location.pathname + location.search;
    if (scope === current) return;
    if (scope) firstResourceTime = performance.now();
    scope = current;
    sources.clear();
    reportCount();
  }

  function scanPlayer() {
    syncScope();
    for (const video of document.querySelectorAll("video")) {
      addSource(video.getAttribute("data-hls-src"), "HLS", "播放器");
      addSource(video.currentSrc, "影片", "播放器");
      addSource(video.getAttribute("src"), "影片", "播放器");
      for (const source of video.querySelectorAll("source[src]")) {
        const mime = source.type.split(";", 1)[0].trim().toLowerCase();
        const format = Object.hasOwn(mimeFormats, mime) ? mimeFormats[mime] : "影片";
        addSource(source.src, format, "播放器");
      }
    }
    for (const meta of document.querySelectorAll(
      'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]',
    )) {
      addSource(meta.content, "", "網頁資訊");
    }
  }

  function scanRequests(entries) {
    syncScope();
    for (const entry of entries) {
      if (entry.startTime < firstResourceTime || entry.responseStatus >= 400) continue;
      const mime = (entry.contentType || "").split(";", 1)[0].trim().toLowerCase();
      if (mime === "text/html") continue;
      const format = Object.hasOwn(mimeFormats, mime) ? mimeFormats[mime] : "";
      addSource(entry.name, format, "載入請求");
    }
  }

  function queuePlayerScan() {
    if (queuedScan) return;
    queuedScan = setTimeout(() => {
      queuedScan = null;
      scanPlayer();
    }, 100);
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "read-videos" && message?.type !== "rescan-videos") return;
    scanPlayer();
    sendResponse({ sources: [...sources.values()] });
  });

  new MutationObserver(queuePlayerScan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-hls-src"],
  });
  document.addEventListener("loadstart", queuePlayerScan, true);
  window.addEventListener("popstate", queuePlayerScan);
  scanPlayer();
  new PerformanceObserver((list) => scanRequests(list.getEntries())).observe({
    type: "resource",
    buffered: true,
  });
})();
