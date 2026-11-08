import { allowMediaHost, mediaCredentials, mediaUrl } from "./media-access.js";
import { Conversion, HLS_FORMATS, Input, Mp4OutputFormat, Output, StreamTarget, UrlSource } from "./vendor/mediabunny.mjs";

const status = document.querySelector("#status");
const progress = document.querySelector("#progress");
const save = document.querySelector("#save");
const allow = document.querySelector("#allow");
const cancel = document.querySelector("#cancel");
let selected;
let blockedHost;
let stopDownload;

class DownloadError extends Error {}

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
      if (text.length > 8 * 1024 * 1024) throw new DownloadError("串流清單過大，無法下載。");
    }
    if (/^#EXT-X-(?:SESSION-)?KEY:(?!\s*METHOD=NONE(?:,|\s|$))/m.test(text)) {
      throw new DownloadError("此串流已加密。這裡支援未加密影片的下載。");
    }
    if (/^#EXTINF:/m.test(text) && !/^#EXT-X-ENDLIST\s*$/m.test(text)) {
      throw new DownloadError("此串流仍在直播，請選擇已結束的影片。");
    }
  } finally {
    // A cloned stream's cancel promise can wait for the original stream to finish.
    reader.cancel().catch(() => {});
  }
}

async function fetchMedia(value, init) {
  const url = mediaUrl(value);
  let response;
  try {
    response = await fetch(url, { ...init, credentials: mediaCredentials(url, selected.pageOrigin) });
  } catch (error) {
    if (error instanceof TypeError && !init?.signal?.aborted) {
      blockedHost = url;
      throw new DownloadError("無法讀取影片來源。可允許來源後重試。");
    }
    throw error;
  }
  if (!response.ok) {
    response.body?.cancel().catch(() => {});
    if (response.status === 401 || response.status === 403) {
      throw new DownloadError("影片來源拒絕存取。請重新整理原頁並重新選擇影片。");
    }
    throw new DownloadError(`影片來源回傳 HTTP ${response.status}。`);
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

save.addEventListener("click", async () => {
  save.disabled = true;
  allow.hidden = true;
  blockedHost = null;
  let file;
  let input;
  let cancelled = false;
  try {
    const handle = await showSaveFilePicker({
      suggestedName: "影片.mp4",
      types: [{ description: "MP4 影片", accept: { "video/mp4": [".mp4"] } }],
    });
    file = await handle.createWritable();
    stopDownload = () => {
      cancelled = true;
      cancel.disabled = true;
      input?.dispose();
    };
    cancel.disabled = false;
    cancel.hidden = false;
    progress.hidden = false;
    progress.removeAttribute("value");
    status.textContent = "正在讀取串流。";

    const source = new UrlSource(selected.url, { fetchFn: fetchMedia, getRetryDelay: () => null });
    input = new Input({ source, formats: HLS_FORMATS });
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (!video) throw new DownloadError("串流中找不到可用的影像。");
    if (await video.isLive() || await audio?.isLive()) {
      throw new DownloadError("此串流仍在直播，請選擇已結束的影片。");
    }
    const target = new StreamTarget(new WritableStream({ write: (chunk) => file.write(chunk) }));
    const output = new Output({ target, format: new Mp4OutputFormat() });
    const conversion = await Conversion.init({ input, output, copy: { mode: "forced" } });
    if (!conversion.isValid || !conversion.utilizedTracks.includes(video)
      || (audio && !conversion.utilizedTracks.includes(audio))) {
      throw new DownloadError("這個串流的影音格式無法直接儲存為 MP4。");
    }
    status.textContent = "正在下載影片。";
    conversion.onProgress = (value) => {
      progress.value = value;
    };
    await conversion.execute();
    if (cancelled) throw new Error("Download cancelled");
    cancel.disabled = true;
    await file.close();
    file = null;
    status.textContent = `已儲存 ${handle.name}。`;
    return;
  } catch (error) {
    await file?.abort().catch(() => {});
    if (cancelled || error.name === "AbortError") {
      status.textContent = "已取消下載。";
    } else {
      status.textContent = error instanceof DownloadError ? error.message : "未能儲存影片。請確認串流可播放後再試。";
      allow.hidden = !blockedHost;
    }
    save.disabled = false;
  } finally {
    stopDownload = null;
    input?.dispose();
    progress.hidden = true;
    cancel.hidden = true;
  }
});

cancel.addEventListener("click", () => stopDownload?.());

allow.addEventListener("click", async () => {
  try {
    if (await allowMediaHost(blockedHost)) {
      allow.hidden = true;
      status.textContent = "已允許影片來源。請再次選擇儲存位置。";
    }
  } catch {
    status.textContent = "未能取得影片來源的權限。";
  }
});

const key = location.hash.slice(1);
try {
  if (!/^hls-[\da-f-]+$/i.test(key)) throw new Error("Invalid download ID");
  selected = (await chrome.storage.session.get(key))[key];
  if (!selected) throw new Error("Missing download");
  mediaUrl(selected.url);
  await chrome.storage.session.remove(key);
  status.textContent = "選擇儲存位置後，會將串流儲存為 MP4。";
  save.disabled = false;
} catch {
  status.textContent = "下載項目已失效，請從擴充功能清單重新選擇。";
}
