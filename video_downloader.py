"""Scan a web page for video sources and optionally save a selected file."""

import argparse
import shutil
import sys
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.parse import urldefrag, urlsplit
from urllib.request import Request, urlopen

from playwright.sync_api import Error as BrowserError, sync_playwright


FORMATS = {".mp4": "MP4", ".webm": "WebM", ".m3u8": "HLS", ".mpd": "DASH"}
MEDIA_TYPES = {
    "video/mp4": "MP4",
    "video/webm": "WebM",
    "application/vnd.apple.mpegurl": "HLS",
    "application/x-mpegurl": "HLS",
    "application/dash+xml": "DASH",
}
DIRECT_TYPES = {"MP4": "video/mp4", "WebM": "video/webm"}


def is_http_url(url):
    parsed = urlsplit(url)
    return parsed.scheme in {"https", "http"} and bool(parsed.hostname)


def add_source(sources, url, content_type=""):
    if not url or not is_http_url(url):
        return
    url, _ = urldefrag(url)
    suffix = Path(urlsplit(url).path).suffix.lower()
    if suffix in {".m4s", ".ts", ".cmfv", ".cmfa"}:
        return
    content_type = content_type.split(";", 1)[0].strip().lower()
    kind = MEDIA_TYPES.get(content_type)
    if not kind and content_type in {"", "application/octet-stream"}:
        kind = FORMATS.get(suffix)
    if kind:
        sources[url] = kind


def scan(url):
    sources = {}
    add_source(sources, url)
    if sources:
        return sources, ""

    with sync_playwright() as playwright:
        with playwright.chromium.launch(channel="chrome", headless=True) as browser:
            page = browser.new_page(locale="zh-TW", accept_downloads=False)

            def observe(response):
                if response.status not in {200, 206}:
                    return
                add_source(sources, response.url, response.headers.get("content-type", ""))

            page.on("response", observe)
            document = page.goto(url, wait_until="domcontentloaded", timeout=30000)
            if document and document.status >= 400:
                raise ValueError(f"網頁回傳 HTTP {document.status}。")
            page.wait_for_timeout(4000)

            for frame in page.frames:
                if frame.is_detached():
                    continue
                elements = frame.locator("video, video source").evaluate_all(
                    """nodes => nodes.flatMap(node =>
                        [node.currentSrc, node.getAttribute('src'),
                         node.getAttribute('data-hls-src')].filter(Boolean).map(src => {
                            try {
                                return [new URL(src, node.baseURI).href, node.type || ''];
                            } catch {
                                return ['', ''];
                            }
                        }))"""
                )
                for source_url, content_type in elements:
                    add_source(sources, source_url, content_type)

            user_agent = page.evaluate("navigator.userAgent")
    return sources, user_agent


def download(url, kind, folder, user_agent):
    headers = {"User-Agent": user_agent} if user_agent else {}
    with urlopen(Request(url, headers=headers), timeout=30) as response:
        if response.status != 200:
            raise ValueError(f"下載需要完整檔案，伺服器回傳 HTTP {response.status}。")
        content_type = response.headers.get_content_type()
        header = response.read(16)
        signature_matches = (
            header[4:8] == b"ftyp" if kind == "MP4" else header.startswith(b"\x1a\x45\xdf\xa3")
        )
        if content_type != DIRECT_TYPES[kind] and not signature_matches:
            raise ValueError("伺服器回傳的資料與所選影片格式不符。")

        folder.mkdir(parents=True, exist_ok=True)
        with NamedTemporaryFile(dir=folder, prefix="video-", suffix=".part", delete=False) as output:
            partial = Path(output.name)
        try:
            with partial.open("wb") as output:
                output.write(header)
                shutil.copyfileobj(response, output, length=1024 * 1024)
            expected_size = response.headers.get("Content-Length")
            actual_size = partial.stat().st_size
            if actual_size == 0 or (expected_size and actual_size != int(expected_size)):
                raise ValueError("收到的檔案大小不完整。")
            destination = partial.with_suffix(f".{kind.lower()}")
            partial.rename(destination)
        finally:
            partial.unlink(missing_ok=True)
    return destination


def main():
    parser = argparse.ArgumentParser(description="搜尋網頁影片，並選擇是否下載直連檔案。")
    parser.add_argument("url", help="網頁或影片網址")
    parser.add_argument("--download", action="store_true", help="掃描後顯示下載選單")
    parser.add_argument("--output", type=Path, default=Path.home() / "Downloads", help="儲存資料夾")
    args = parser.parse_args()

    try:
        if not is_http_url(args.url):
            parser.error("請輸入 HTTP 或 HTTPS 網址。")
        sources, user_agent = scan(args.url)
        entries = list(sources.items())
        print(f"偵測到 {len(entries)} 筆影片來源。")
        for number, (source_url, kind) in enumerate(entries, 1):
            status = "直連檔案候選" if kind in DIRECT_TYPES else "串流清單"
            print(f"{number}. [{kind} / {status}] {source_url}")
        if args.download and any(kind in DIRECT_TYPES for _, kind in entries):
            choice = input("輸入要下載的直連檔案編號，或按 Enter 結束：").strip()
            if choice:
                if not choice.isdecimal() or not 1 <= int(choice) <= len(entries):
                    raise ValueError("請輸入清單上的編號。")
                source_url, kind = entries[int(choice) - 1]
                if kind not in DIRECT_TYPES:
                    raise ValueError("此版本支援下載 MP4 與 WebM 直連檔案。")
                path = download(source_url, kind, args.output, user_agent)
                print(f"已儲存 {path.resolve()}")
    except (KeyboardInterrupt, EOFError):
        return 1
    except (BrowserError, OSError, ValueError) as error:
        print(f"處理失敗：{error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
