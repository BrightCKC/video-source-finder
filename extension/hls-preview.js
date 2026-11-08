import { allowMediaHost, mediaCredentials, mediaUrl } from "./media-access.js";

let closePreview;

export function makeHlsPreview(source, pageOrigin) {
  const element = document.createElement("div");
  element.className = "preview";
  const video = document.createElement("video");
  video.preload = "none";
  video.playsInline = true;
  video.setAttribute("aria-label", "HLS 影片預覽");
  const overlay = document.createElement("div");
  overlay.className = "preview-overlay";
  const play = document.createElement("button");
  play.type = "button";
  play.textContent = "▶ 播放預覽";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  status.hidden = true;
  overlay.append(play, status);
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
    play.disabled = false;
    play.textContent = "▶ 播放預覽";
    status.hidden = true;
    if (closePreview === stop) closePreview = null;
  }

  function fail(message, retryHost) {
    stop();
    blockedHost = retryHost;
    play.textContent = retryHost ? "允許來源並重試" : "重試預覽";
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

  play.addEventListener("click", async () => {
    closePreview?.();
    closePreview = stop;
    const current = {};
    attempt = current;
    play.disabled = true;
    play.textContent = "正在載入預覽";
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
      player.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
      player.loadSource(source);
      player.attachMedia(video);
    } catch {
      if (attempt === current) fail("這個影片目前無法播放。", blockedHost);
    }
  });
  return { element, stop };
}
