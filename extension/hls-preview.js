import { allowMediaHost, mediaCredentials, mediaUrl } from "./media-access.js";
import { t } from "./i18n.js";

let closePreview;

export function makeHlsPreview(source, pageOrigin) {
  const element = document.createElement("div");
  element.className = "preview";
  element.tabIndex = 0;
  const video = document.createElement("video");
  video.preload = "none";
  video.playsInline = true;
  video.muted = true;
  const overlay = document.createElement("div");
  overlay.className = "preview-overlay";
  const cue = document.createElement("p");
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
  let cueMessage = "hoverPreview";
  let errorMessage;

  function localize() {
    element.setAttribute("aria-label", t("previewKeyboard"));
    video.setAttribute("aria-label", t("previewLabel"));
    cue.textContent = t(cueMessage);
    retry.textContent = t(blockedHost ? "allowAndRetry" : "retryPreview");
    status.textContent = errorMessage ? t(errorMessage) : "";
  }

  function stop() {
    attempt = null;
    player?.destroy();
    player = null;
    video.removeAttribute("src");
    video.load();
    video.controls = false;
    overlay.hidden = false;
    cue.hidden = false;
    cueMessage = "hoverPreview";
    errorMessage = null;
    retry.hidden = true;
    status.hidden = true;
    if (closePreview === stop) closePreview = null;
    localize();
  }

  function fail(message, retryHost) {
    stop();
    blockedHost = retryHost;
    cue.hidden = true;
    retry.hidden = false;
    errorMessage = message;
    status.hidden = false;
    localize();
  }

  video.addEventListener("loadeddata", () => {
    if (!attempt) return;
    overlay.hidden = true;
    video.controls = true;
  });
  video.addEventListener("error", () => {
    if (attempt) fail("previewFailed");
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
    cueMessage = "loadingPreview";
    errorMessage = null;
    status.hidden = true;
    localize();
    try {
      if (blockedHost) {
        const allowed = await allowMediaHost(blockedHost);
        if (attempt !== current) return;
        if (!allowed) {
          fail("previewNeedsPermission", blockedHost);
          return;
        }
        blockedHost = null;
      }
      const { default: Hls } = await import("./vendor/hls.min.mjs");
      if (attempt !== current) return;
      if (!Hls.isSupported()) {
        fail("previewUnsupported");
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
        fail("previewLoadFailed", retryHost);
      });
      player.on(Hls.Events.MANIFEST_PARSED, () => {
        video.muted = true;
        video.play().catch(() => {});
      });
      player.loadSource(source);
      player.attachMedia(video);
    } catch {
      if (attempt === current) fail("previewFailed", blockedHost);
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
  localize();
  return { element, stop, localize };
}
