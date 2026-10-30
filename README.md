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

## ChatGPT Sites（crypto.oxpattern.com，準備中）

Vercel 照常運作，直到擁有者切換。Sites 版由 `npm run build:sites` 產生 `dist/`：`dist/client` 是公開網站（資料檔只放在 `_seed/`），`dist/server/index.js` 是 Worker（API、`/admin`、`/privacy`、`/terms`、`/data/*.json`），`dist/.openai/hosting.json` 需要換成新 Site 的 project_id，綁定 D1 `DB` 與 R2 `BUCKET`。

- 後台 `/admin`：只有用 ChatGPT 登入的擁有者（`OX_ADMIN_EMAILS`，預設 a0979989987@gmail.com）。使用紀錄、公告、功能開關、意見回饋、會員名單、Bitget UID 審核。
- 會員：Google 登入（`GOOGLE_CLIENT_ID`、密鑰 `GOOGLE_CLIENT_SECRET`，回呼 `https://crypto.oxpattern.com/api/v1/auth/google/callback`）。同步的設定清單在 `src/app/sync-keys.js`；可暫停的工具在 `src/app/site-features.js`。
- Bitget UID 自動查詢（唯讀，選用）：密鑰 `BITGET_AFFILIATE_API_KEY`、`BITGET_AFFILIATE_SECRET_KEY`、`BITGET_AFFILIATE_PASSPHRASE`。通過只顯示「Bitget 已驗證」，不影響任何功能。
- 資料更新：排程把資料提交到 main 後，若儲存庫變數 `OX_SITES_DATA` 是 `on`，同一個工作會用 GitHub OIDC 把 `data/`、`previews/data/` 發布到 Site 的 R2（`scripts/publish-site-data.mjs`）；`OX_SITE_ORIGIN` 可在網域生效前指向 chatgpt.site 網址。首次請手動執行 `Publish verified data to Sites`。
- 資安：API 只接受網站自己的網址（`crypto.oxpattern.com`；Site 的 chatgpt.site 網址放在 Worker 變數 `OX_SITE_ORIGIN`，多個用逗號分開），同一個 IP 每分鐘超過 600 次回 429，會改資料的請求沒有 Origin 一律拒絕；每個回應都帶 nosniff、Referrer-Policy、Permissions-Policy、HSTS。
- 本機：`OX_DEV_ADMIN=你的Email OX_DEV_FAKE_GOOGLE=1 node scripts/dev-server.mjs --port 4313`（本機 D1 在 `.local/`，假的 Google 登入只在本機）。
- 切換網域後，把 `vercel.redirect.json` 的內容換進 `vercel.json`，舊網址就會轉到 crypto.oxpattern.com。
