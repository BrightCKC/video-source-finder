# Video Source Finder 網頁影片偵測器

Video Source Finder 是 Chrome 擴充功能，可列出目前分頁偵測到的影片來源，並讓你預覽、下載或複製網址。此說明適用於 `v0.4.0`，需要 Chrome 120 或更新版本。

## 安裝

1. 解壓縮 `video-source-finder-v0.4.0.zip`。若你已取得專案原始碼，也可以直接使用 `extension` 資料夾。
2. 在 Chrome 網址列輸入 `chrome://extensions`，開啟右上角的「開發人員模式」。
3. 點「載入未封裝項目」，選取含有 `manifest.json` 的資料夾。
4. 重新整理影片頁面，從 Chrome 工具列的擴充功能選單開啟 **Video Source Finder**。

在 Windows 或 macOS 的一般 Chrome 環境，請使用上述 ZIP 解壓縮方式安裝。本專案也提供 Chrome 封裝格式 `.crx`，供支援該格式的部署環境使用。 [Chrome 載入未封裝擴充功能](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#load-unpacked) · [Chrome 擴充功能發佈方式](https://developer.chrome.com/docs/extensions/how-to/distribute)

## 使用方式

1. 開啟影片所在的網頁，再點工具列上的 **Video Source Finder**。Chrome 會暫時授予擴充功能存取目前分頁的權限，以開始掃描。 [Chrome 的目前分頁權限](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab)
2. 將滑鼠移到 HLS 預覽畫面上即可靜音播放，移開時會暫停。清單優先顯示影片名稱，缺少名稱時會採用可取得的影片圖說或頁面標題。
3. 點 **Download／下載**，在儲存對話框選擇資料夾和檔名。HLS 影片選好儲存位置後，會在背景繼續處理。也可以用 **Copy URL／複製網址** 複製串流來源。
4. 從清單上方的 **Language／語言** 選單選擇 **English** 或 **繁體中文**。預設是英文，瀏覽器會記住上次選擇。

| 偵測格式 | 可用功能 |
| --- | --- |
| MP4、WebM、MOV、OGV | 直接下載原始檔案 |
| HLS（`.m3u8`） | 預覽、複製網址。未加密的隨選串流可儲存為 MP4 |
| DASH（`.mpd`） | 複製串流網址 |

### 找不到影片或無法載入

- 有些網站會在播放後才發出影片請求。先在原網頁播放影片，再回到擴充功能清單按 **Rescan／重新掃描**。
- 若出現來源權限提示，可按 **Allow video source／允許影片來源**，授權後重試。若網址已過期，請重新整理原網頁再選一次影片。
- 如果 HLS 顯示仍在直播或已加密，請選擇可下載的未加密隨選影片。

## 更新本機版本

將新版解壓縮到原先載入的資料夾，在 `chrome://extensions` 點擴充功能卡片上的「重新載入」，再重新整理影片頁面。若解壓縮到另一個位置，請選取新版資料夾載入。

## 專案檔案

- `extension/` 包含 Chrome 擴充功能及執行所需的檔案，可直接載入。
- `video_downloader.py` 是早期的命令列工具。要使用它，先安裝 `requirements.txt` 中的依賴，再執行 `python video_downloader.py "網頁網址"`。加入 `--download` 可在掃描後選擇要下載的 MP4 或 WebM 檔案。
- 第三方元件及其授權說明見 [THIRD-PARTY.txt](extension/vendor/THIRD-PARTY.txt)。
