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

  function titleLine(value) {
    if (typeof value !== "string") return "";
    const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
    const characters = Array.from(line.replace(/\s+/g, " "));
    return characters.length > 120 ? characters.slice(0, 119).join("") + "…" : characters.join("");
  }

  function addSource(value, hint, foundIn, title = "", titlePriority = 0) {
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
      if (existing.format === "video" && format !== "video") existing.format = format;
      if (title && titlePriority >= existing.titlePriority) {
        existing.title = title;
        existing.titlePriority = titlePriority;
      }
      return;
    }
    sources.set(url.href, { url: url.href, host: url.host, format, foundIn, title, titlePriority });
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
    const pageTitle = titleLine(
      document.querySelector('meta[property="og:title"]')?.content || document.title,
    );
    for (const video of document.querySelectorAll("video")) {
      const videoTitle = titleLine(video.dataset.title || video.title);
      const caption = titleLine(video.closest("figure")?.querySelector("figcaption")?.textContent);
      const title = videoTitle || caption || pageTitle;
      const priority = videoTitle ? 3 : caption ? 2 : 1;
      addSource(video.getAttribute("data-hls-src"), "HLS", "sourcePlayer", title, priority);
      addSource(video.currentSrc, "video", "sourcePlayer", title, priority);
      addSource(video.getAttribute("src"), "video", "sourcePlayer", title, priority);
      for (const source of video.querySelectorAll("source[src]")) {
        const mime = source.type.split(";", 1)[0].trim().toLowerCase();
        const format = Object.hasOwn(mimeFormats, mime) ? mimeFormats[mime] : "video";
        addSource(source.src, format, "sourcePlayer", title, priority);
      }
    }
    for (const meta of document.querySelectorAll(
      'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]',
    )) {
      addSource(meta.content, "", "sourceMetadata", pageTitle, 1);
    }
  }

  function scanRequests(entries) {
    syncScope();
    const pageTitle = titleLine(document.title);
    for (const entry of entries) {
      if (entry.startTime < firstResourceTime || entry.responseStatus >= 400) continue;
      const mime = (entry.contentType || "").split(";", 1)[0].trim().toLowerCase();
      if (mime === "text/html") continue;
      const format = Object.hasOwn(mimeFormats, mime) ? mimeFormats[mime] : "";
      addSource(entry.name, format, "sourceRequest", pageTitle);
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
    sendResponse({
      sources: Array.from(sources.values(), ({ titlePriority, ...item }) => item),
    });
  });

  new MutationObserver(queuePlayerScan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "data-hls-src", "title", "data-title"],
  });
  document.addEventListener("loadstart", queuePlayerScan, true);
  window.addEventListener("popstate", queuePlayerScan);
  scanPlayer();
  new PerformanceObserver((list) => scanRequests(list.getEntries())).observe({
    type: "resource",
    buffered: true,
  });
})();
