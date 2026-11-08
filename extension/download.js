import { mediaCredentials, mediaUrl } from "./media-access.js";
import { Conversion, HLS_FORMATS, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource } from "./vendor/mediabunny.mjs";

let blockedHost;
let stopDownload;

class DownloadError extends Error {
  constructor(message, ...values) {
    super(message);
    this.values = values;
  }
}

async function checkPlaylist(response) {
  // Detect manifests by their signature, including when the URL has no extension.
  const reader = response.clone().body.getReader();
  const decoder = new TextDecoder();
  try {
    let text = "";
    while (text.length < 7) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value.subarray(0, 10), { stream: true });
      if (text.length >= 7) {
        if (!text.startsWith("#EXTM3U")) return;
        text += decoder.decode(value.subarray(10), { stream: true });
      }
    }
    if (!text.startsWith("#EXTM3U")) return;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > 8 * 1024 * 1024) throw new DownloadError("playlistTooLarge");
    }
    if (/^#EXT-X-(?:SESSION-)?KEY:(?!\s*METHOD=NONE(?:,|\s|$))/m.test(text)) {
      throw new DownloadError("encryptedStream");
    }
    if (/^#EXTINF:/m.test(text) && !/^#EXT-X-ENDLIST\s*$/m.test(text)) {
      throw new DownloadError("liveStream");
    }
  } finally {
    // A cloned stream's cancel promise can wait for the original stream to finish.
    reader.cancel().catch(() => {});
  }
}

async function fetchMedia(value, init, pageOrigin) {
  const url = mediaUrl(value);
  let response;
  try {
    response = await fetch(url, { ...init, credentials: mediaCredentials(url, pageOrigin) });
  } catch (error) {
    if (error instanceof TypeError && !init?.signal?.aborted) {
      blockedHost = url.origin;
      throw new DownloadError("downloadNeedsPermission");
    }
    throw error;
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new DownloadError("accessDenied");
    }
    throw new DownloadError("httpError", response.status);
  }
  const range = new Headers(init?.headers).get("range");
  if (response.body && (!range || range.startsWith("bytes=0-"))) {
    try {
      await checkPlaylist(response);
    } catch (error) {
      response.body.cancel().catch(() => {});
      throw error;
    }
  }
  return response;
}

async function saveVideo({ url, pageOrigin, handle }) {
  let file;
  let input;
  let cancelled = false;
  stopDownload = () => {
    cancelled = true;
    input?.dispose();
  };
  try {
    file = await handle.createWritable({ mode: "exclusive" });
    if (cancelled) throw new Error("Download cancelled");
    self.postMessage({ status: "running", message: "readingStream" });
    const source = new UrlSource(url, {
      fetchFn: (value, init) => fetchMedia(value, init, pageOrigin),
      getRetryDelay: () => null,
    });
    input = new Input({ source, formats: HLS_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new DownloadError("missingVideoTrack");
    if (await video.isLive() || await audio?.isLive()) {
      throw new DownloadError("liveStream");
    }
    const target = new StreamTarget(new WritableStream({ write: (chunk) => file.write(chunk) }));
    const output = new Output({ target, format: new Mp4OutputFormat() });
    const conversion = await Conversion.init({ input, output, copy: { mode: "forced" } });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video)
      || (audio && !conversion.utilizedTracks.includes(audio))) {
      throw new DownloadError("incompatibleMp4");
    }
    let previousPercent = -1;
    conversion.onProgress = (value) => {
      const percent = Math.floor(value * 100);
      if (percent === previousPercent) return;
      previousPercent = percent;
      self.postMessage({ status: "running", message: "downloadingVideo", values: [percent] });
    };
    await conversion.execute();
    if (cancelled) throw new Error("Download cancelled");
    stopDownload = null;
    await file.close();
    file = null;
    self.postMessage({ status: "done", message: "savedFile", values: [handle.name] });
  } catch (error) {
    await file?.abort().catch(() => {});
    if (cancelled || error.name === "AbortError") {
      self.postMessage({ status: "cancelled", message: "downloadCancelled" });
    } else {
      const failure = error instanceof DownloadError ? error : new DownloadError("downloadFailed");
      self.postMessage({ status: "error", message: failure.message, values: failure.values, blockedHost });
    }
  } finally {
    stopDownload = null;
    input?.dispose();
  }
}

self.addEventListener("message", ({ data }) => {
  if (data.type === "cancel") {
    stopDownload?.();
    return;
  }
  saveVideo(data);
});
