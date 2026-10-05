# OX 加密獨立版

由原正式版 `a0979989987-coder/ox-crypto-screener` 的 `main` 提交 `0c193666f65f51022f02a99d81d4ba6454cfa949`（2026-10-05 22:03，台北時間）獨立複製。原儲存庫、正式部署和設定均未修改。

保留完整加密首頁、T1/T2/T3 雷達、即時 K 線與畫線、型態畫板、泡泡圖、強弱分析、熱力圖、資金輪動、主動買賣、新聞行事曆、媒體、設定、OX LIVE、OX Account 及 OX Admin。保留原版掃描逐步顯示、畫板預載、資料快取與有限重試。

移除台股市場入口、台股功能搜尋、台股前後端模組、台股資料快照及更新排程；新聞只收錄加密與原本有標示適用加密的國際事件。帳號資料庫相容性用的既有功能 ID 與 SQL 保留，畫面不顯示台股選項。

## 執行與檢查

```sh
npm ci
npm run build:tools
npm run check
npm test
npm run dev
```

加密行情直接使用原版公共資料源。`src/generated/runtime.js` 和 `pattern-worker.js` 已重新產生，不含台股模組。

## 部署及帳號服務

此專案沿用 Vercel 的同源後端。匯入此 GitHub 儲存庫後，使用 Node.js 22，根目錄 `./`，建置指令由 `vercel.json` 提供。

帳號、Google 登入、Email 登入、HttpOnly 工作階段、UID 連結、管理員審核和功能權限的程式都完整保留。它們需要 `.env.example` 中的後端環境變數；這些變數沒有包含在 GitHub，也没有從原專案複製。

`OX_ACCOUNT_ORIGIN` 必須設定為新站的 HTTPS origin。Google／Supabase 的回呼白名單必須允許新站 `/api/v1/account/callback`。不得為了讓介面顯示而停用原來的登入或管理員檢查。

新站尚未設定後端環境變數，因此目前不能宣稱已驗證新站的真實登入、會員資料或後台連線。不可直接將本專案當成只有靜態內容的 GitHub Pages 網站：Account 和功能政策需要同源 API。

## 驗證範圍

見 `docs/independent-release.md`。瀏覽器測試使用明確合成資料，不代表即時市場行情與真實帳號的正式驗收。
