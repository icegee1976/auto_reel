# Auto Reel

簡易版 Reel 自動生成工具。把圖片、影片、音樂丟進去，調整每個素材卡片或批次設定後，一鍵輸出有配樂的 MP4。

## 設計取樣

- [CapCut AI Template Generator](https://www.capcut.com/tools/ai-template-generator)：短影音導向、模板、音樂與社群尺寸是核心入口。
- [Canva Photo Video Maker](https://www.canva.com/create/photo-videos/) / [Canva Music Video Maker](https://www.canva.com/create/music-videos/)：用圖片、影片、音樂快速組合成可分享影片。
- [Adobe Express Add Music](https://www.adobe.com/express/feature/video/add-music) / [Adobe Express Photo Video](https://www.adobe.com/express/create/video/photo)：強調上傳影音素材、加入音樂、快速輸出。
- [Animoto](https://animoto.com/)：用 drag-and-drop 與 block/card 型素材組合降低時間軸編輯負擔。
- [Remotion](https://www.remotion.dev/) / [MoviePy](https://zulko.github.io/moviepy/)：開源/程式化影片產生工具，適合自動化但不適合直接給一般使用者裸用。
- [slideshow-video](https://github.com/0x464e/slideshow-video) / [videoshow](https://github.com/h2non/videoshow)：FFmpeg slideshow 類工具證明「圖片 + 音樂 + 自動合成」可用簡單設定完成。

取樣後的 MVP 決定：模仿 Animoto/Canva 的素材卡片流，保留 CapCut/Canva 常用的 9:16 Reel 輸出，但不做剪輯軟體式時間軸。

## MVP 規格

- 拖放上傳圖片、影片、音樂。
- 圖片與影片會變成獨立素材卡片，不提供多軌時間軸。
- 每張素材卡可設定秒數、裁切/留邊、圖片推近、淡入淡出、影片起點。
- 批次套用秒數、填滿方式、圖片動態與轉場效果。
- 圖片動態包含推近、拉遠、上下左右平移、靜止。
- 轉場效果包含柔和淡化、黑場、白閃、無轉場。
- 可選擇畫面自動優化，套用色彩、對比、曝光與銳利度調整。
- 音樂區可設定輸出音量，支援 0% 靜音到 200% 放大。
- 音樂區可開啟自動降噪、去除人聲或強化人聲。
- 預設 9:16 Reel，可切換 1:1 與 16:9。
- 多首音樂會依序接成播放清單，不足影片長度時循環。
- 輸出 MP4 / H.264，檔案存到 `data/outputs/`。

## 輸出尺寸

| 比例 | Preview | Standard | Full |
| --- | --- | --- | --- |
| 9:16 Reel | 540 x 960 | 720 x 1280 | 1080 x 1920 |
| 1:1 方形 | 720 x 720 | 1080 x 1080 | 1440 x 1440 |
| 16:9 橫式 | 960 x 540 | 1280 x 720 | 1920 x 1080 |

UI 預設是 `9:16 Reel` + `Full`，也就是 `1080 x 1920`。測試時可以切到 `Preview` 讓 FFmpeg 輸出更快。

## 啟動

```powershell
.\start.ps1
```

或雙擊 `Auto Reel Launcher.bat` / `start.bat`。

開發模式會啟動：

- 一般使用: http://127.0.0.1:4100
- 開發 UI: http://127.0.0.1:5173
- 開發 API: http://127.0.0.1:4100

## 指令

```powershell
npm install
.\start.ps1
npm run dev
npm run build
npm start
```

## 目前刻意不做

- 多軌時間軸
- 細緻 keyframe
- 字幕編輯器
- AI 腳本/配音/素材生成
- 複雜音訊混音
