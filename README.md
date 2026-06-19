# JASIC V2 台股戰情中心

這是由既有 JASIC 公開版獨立建立的 V2 靜態網站，不會修改原本的 `jasic-app` 或 `yipojacky-wq/Jacky` Repository。

## V2 新功能

- 短期買賣建議區：依證交所最新交易日資料動態排序，可切換 10／20 檔。
- 自選股戰情分析：使用 JASIC 均線、RSI、動能與量能訊號產生戰情卡。
- 熱門衝刺建議區：比對可追溯的外資目標價與證交所最新股價，只保留價差至少 100 元者，依價差排序前十名並附 JASIC 戰情快照。
- 本機保存：自選股存在瀏覽器 `localStorage`，最多 20 檔，可自由新增與刪除。
- 獨立儲存鍵：`jasic-v2-battle-watchlist`，不會覆蓋舊版清單。
- 每個交易日由 GitHub Actions 更新熱門衝刺區的證交所參考價格；新聞來源、日期與目標價保留在 `data/hot-sprint.json`。

## 本機預覽

此專案為純 HTML、CSS、JavaScript，可使用任一靜態伺服器開啟，例如：

```powershell
python -m http.server 8080
```

再瀏覽 `http://localhost:8080`。

## GitHub Pages

建立新的 GitHub Repository 後，把本目錄內容放在 Repository 根目錄，並在 Settings → Pages 選擇從主要分支根目錄部署。

## 資料與風險說明

資料來源為臺灣證券交易所公開資料與既有 JASIC 即時報價服務。所有訊號均為歷史行情的量化觀察，不構成投資建議。
