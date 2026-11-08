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
  const deferredAttributes = {
    "data-hls-src": "HLS",
    "data-video-src": "video",
    "data-video-url": "video",
    "data-src": "",
  };
  const deferredSelector = Object.keys(deferredAttributes).map((name) => `[${name}]`).join(", ");
  const sources = new Map();
  const pageSources = new Map();
  let scope;
  let firstResourceTime = 0;
  let queuedScan;

  function reportCount() {
    let count = sources.size;
    for (const url of pageSources.keys()) {
      if (!sources.has(url)) count++;
    }
    chrome.runtime.sendMessage({ type: "video-count", count }).catch(() => {});
  }

  function titleLine(value) {
    if (typeof value !== "string") return "";
    const line = value.split(/\r?\n/).map((part) => part.trim()).find(Boolean) || "";
    const characters = Array.from(line.replace(/\s+/g, " "));
    return characters.length > 120 ? characters.slice(0, 119).join("") + "…" : characters.join("");
  }

  function addSource(value, hint, foundIn, title = "", titlePriority = 0, destination = sources) {
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
    const existing = destination.get(url.href);
    if (existing) {
      const useTitle = title && titlePriority >= existing.titlePriority;
      destination.set(url.href, {
        ...existing,
        format: existing.format === "video" ? format : existing.format,
        foundIn: existing.foundIn === "sourceRequest" ? foundIn : existing.foundIn,
        title: useTitle ? title : existing.title,
        titlePriority: useTitle ? titlePriority : existing.titlePriority,
      });
      return;
    }
    destination.set(url.href, { url: url.href, host: url.host, format, foundIn, title, titlePriority });
    if (destination === sources) reportCount();
  }

  function syncScope() {
    const current = location.origin + location.pathname + location.search;
    if (scope === current) return;
    if (scope) firstResourceTime = performance.now();
    scope = current;
    sources.clear();
    pageSources.clear();
    reportCount();
  }

  function sourceTitle(element) {
    const title = titleLine(element.dataset.videoTitle) || titleLine(element.dataset.title) || titleLine(element.title);
    if (title) return { title, priority: 3 };

    const labelIds = element.getAttribute("aria-labelledby")?.trim().split(/\s+/) || [];
    const label = titleLine(labelIds.map((id) => document.getElementById(id)?.textContent || "").join(" "));
    const caption = titleLine(element.closest("figure")?.querySelector("figcaption")?.textContent);
    const article = element.closest('article, [role="article"]');
    const heading = titleLine(article?.querySelector('h1, h2, h3, h4, h5, h6, [role="heading"]')?.textContent);
    return { title: label || caption || heading, priority: 2 };
  }

  function formatForMime(value) {
    const mime = (value || "").split(";", 1)[0].trim().toLowerCase();
    return Object.hasOwn(mimeFormats, mime) ? mimeFormats[mime] : "";
  }

  function scanStructuredVideos() {
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      let data;
      try {
        data = JSON.parse(script.textContent);
      } catch {
        continue;
      }
      const pending = [data];
      while (pending.length) {
        const record = pending.pop();
        if (!record || typeof record !== "object") continue;
        const types = Array.isArray(record["@type"]) ? record["@type"] : [record["@type"]];
        if (types.some((type) => typeof type === "string" && /^(?:https?:\/\/schema\.org\/)?VideoObject$/.test(type))) {
          const mime = typeof record.encodingFormat === "string" ? record.encodingFormat : "";
          addSource(record.contentUrl, formatForMime(mime) || "video", "sourceMetadata", titleLine(record.name), 3);
        }
        for (const value of Object.values(record)) {
          if (value && typeof value === "object") pending.push(value);
        }
      }
    }
  }

  function scanPlayer() {
    syncScope();
    scanStructuredVideos();
    for (const video of document.querySelectorAll("video")) {
      const { title, priority } = sourceTitle(video);
      addSource(video.currentSrc, "video", "sourcePlayer", title, priority);
      addSource(video.getAttribute("src"), "video", "sourcePlayer", title, priority);
      for (const source of video.querySelectorAll("source[src]")) {
        addSource(source.src, formatForMime(source.type) || "video", "sourcePlayer", title, priority);
      }
    }
    for (const element of document.querySelectorAll(deferredSelector)) {
      const player = element.closest("video");
      const { title, priority } = sourceTitle(player || element);
      for (const [name, hint] of Object.entries(deferredAttributes)) {
        const format = hint || (player ? formatForMime(element.getAttribute("type")) || "video" : "");
        addSource(element.getAttribute(name), format, "sourcePlayer", title, priority);
      }
    }
    const pageTitle = titleLine(document.querySelector('meta[property="og:title"]')?.content || document.title);
    for (const meta of document.querySelectorAll(
      'meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"]',
    )) {
      addSource(meta.content, "", "sourceMetadata", pageTitle, 1);
    }
  }

  function scanRequests(entries) {
    syncScope();
    for (const entry of entries) {
      if (entry.startTime < firstResourceTime || entry.responseStatus >= 400) continue;
      const mime = (entry.contentType || "").split(";", 1)[0].trim().toLowerCase();
      if (mime === "text/html") continue;
      addSource(entry.name, formatForMime(mime), "sourceRequest");
    }
  }

  function scanPageVideos(page) {
    pageSources.clear();
    if (page?.pageUrl !== location.href || !Array.isArray(page.videos)) return;
    for (const video of page.videos) {
      const title = titleLine(video.title);
      const caption = titleLine(video.caption);
      const label = caption && video.sequence ? `${caption} (${video.sequence})` : caption;
      addSource(video.url, "HLS", "sourceMetadata", title || label, title ? 3 : 2, pageSources);
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
    scanPageVideos(message.pageVideos);
    reportCount();
    const current = new Map(sources);
    for (const item of pageSources.values()) {
      addSource(item.url, item.format, item.foundIn, item.title, item.titlePriority, current);
    }
    sendResponse({
      sources: Array.from(current.values(), ({ titlePriority, ...item }) => {
        if (!item.title && current.size === 1 && item.foundIn !== "sourceRequest") {
          item.title = titleLine(document.title);
        }
        return item;
      }),
    });
  });

  new MutationObserver(queuePlayerScan).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src", "title", "data-title", "data-video-title", "aria-labelledby", ...Object.keys(deferredAttributes)],
  });
  document.addEventListener("loadstart", queuePlayerScan, true);
  window.addEventListener("popstate", queuePlayerScan);
  scanPlayer();
  new PerformanceObserver((list) => scanRequests(list.getEntries())).observe({
    type: "resource",
    buffered: true,
  });
})();
