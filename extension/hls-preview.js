import { allowMediaHost, mediaCredentials, mediaUrl } from "./media-access.js";

let closePreview;

export function makeHlsPreview(source, pageOrigin) {
  const element = document.createElement("div");
  element.className = "preview";
  element.tabIndex = 0;
  element.setAttribute("aria-label", "HLS 影片預覽，按 Enter 播放");
  const video = document.createElement("video");
  video.preload = "none";
  video.playsInline = true;
  video.muted = true;
  video.setAttribute("aria-label", "HLS 影片預覽");
  const overlay = document.createElement("div");
  overlay.className = "preview-overlay";
  const cue = document.createElement("p");
  cue.textContent = "滑鼠移到這裡即可預覽";
  const retry = document.createElement("button");
  retry.type = "button";
  retry.hidden = true;
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  overlay.append(cue, retry, status);
  element.append(video, overlay);

  let player;
  let attempt;
  let blockedHost;

  function stop() {
    attempt = null;
    player?.destroy();
    player = null;
    video.removeAttribute("src");
    video.load();
    video.controls = false;
    overlay.hidden = false;
    cue.hidden = false;
    cue.textContent = "滑鼠移到這裡即可預覽";
    retry.hidden = true;
    status.hidden = true;
    if (closePreview === stop) closePreview = null;
  }

  function fail(message, retryHost) {
    stop();
    blockedHost = retryHost;
    cue.hidden = true;
    retry.hidden = false;
    retry.textContent = retryHost ? "允許來源並重試" : "重試預覽";
    status.textContent = message;
    status.hidden = false;
  }

  video.addEventListener("loadeddata", () => {
    if (!attempt) return;
    overlay.hidden = true;
    video.controls = true;
  });
  video.addEventListener("error", () => {
    if (attempt) fail("這個影片目前無法播放。");
  });

  async function start() {
    if (attempt) {
      if (video.controls) {
        video.muted = true;
        video.play().catch(() => {});
      }
      return;
    }
    closePreview?.();
    closePreview = stop;
    const current = {};
    attempt = current;
    retry.hidden = true;
    cue.hidden = false;
    cue.textContent = "正在載入預覽";
    status.hidden = true;
    try {
      if (blockedHost) {
        const allowed = await allowMediaHost(blockedHost);
        if (attempt !== current) return;
        if (!allowed) {
          fail("請允許讀取影片來源後再試。", blockedHost);
          return;
        }
        blockedHost = null;
      }
      const { default: Hls } = await import("./vendor/hls.min.mjs");
      if (attempt !== current) return;
      if (!Hls.isSupported()) {
        fail("這個瀏覽器無法播放 HLS 預覽。");
        return;
      }
      player = new Hls({
        enableWorker: false,
        maxBufferLength: 15,
        backBufferLength: 10,
        fetchSetup: (context, init) => {
          const url = mediaUrl(context.url);
          return new Request(url, { ...init, credentials: mediaCredentials(url, pageOrigin) });
        },
      });
      player.on(Hls.Events.ERROR, (_event, error) => {
        if (!error.fatal || attempt !== current) return;
        let retryHost;
        if (error.type === Hls.ErrorTypes.NETWORK_ERROR && !error.response?.code) {
          try {
            retryHost = mediaUrl(error.url || error.context?.url || error.frag?.url || source);
          } catch {
            retryHost = mediaUrl(source);
          }
        }
        fail("預覽載入失敗，影片網址可能已失效或需要來源權限。", retryHost);
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true;
        video.play().catch(() => {});
      });
      player.loadSource(source);
      player.attachMedia(video);
    } catch {
      if (attempt === current) fail("這個影片目前無法播放。", blockedHost);
    }
  }

  element.addEventListener("mouseenter", () => {
    if (retry.hidden) start();
  });
  element.addEventListener("mouseleave", () => {
    if (!attempt) return;
    if (video.controls) video.pause();
    else if (!blockedHost) stop();
  });
  element.addEventListener("keydown", (event) => {
    if (event.target !== element || !["Enter", " "].includes(event.key)) return;
    event.preventDefault();
    start();
  });
  retry.addEventListener("click", start);
  return { element, stop };
}
