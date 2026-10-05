# OX Account 接續與驗證

已還原原任務匯出的 Google OAuth、Email Magic Link／PKCE、加密 HttpOnly Cookie、會員中心與測試。現有行情功能仍公開；帳號登入不改寫 Bitget 綁定或會員權益。

## 既有專案設定

沿用 Supabase 專案 `zczdxepbrczuyoobafep`，不建立新專案或憑證。

- Google Web client 的 origin：`https://ox-crypto-screener.vercel.app`
- Google Web client 的 redirect URI：`https://zczdxepbrczuyoobafep.supabase.co/auth/v1/callback`
- Supabase URL Configuration 的 Site URL：`https://ox-crypto-screener.vercel.app`
- Supabase Redirect URLs 須包含：`https://ox-crypto-screener.vercel.app/api/v1/account/callback`

使用者在 [既有專案的 Providers](https://supabase.com/dashboard/project/zczdxepbrczuyoobafep/auth/providers) 親自填入既有 Google Client ID／Client Secret 並儲存。程式不需要 Google Secret、Bitget Secret 或 Supabase service-role key。

部署環境保留原設定，僅核對存在與格式，不輸出值：`OX_ACCOUNT_ORIGIN`、`OX_SUPABASE_URL`、`OX_SUPABASE_PUBLISHABLE_KEY`、`OX_AUTH_SESSION_SECRET`（至少 32 字元）。本地沒有這些設定，不能宣稱線上設定已驗證。

`server/account/schema.sql` 是原任務的既有 schema 參考，**不要重新執行**。它使用 auth.users 的新增 trigger 寫入 ox_accounts，會員只能透過 RLS 讀取自己的資料。session API 現在會唯讀核對既有會員列，回傳 stored／missing／unverified；資料庫錯誤不會被當成已儲存，不新增資料表、不自動改權益。

## 路由與安全

`api/v1/account/[endpoint].js` 共用一個 Vercel function，保留 `/api/v1/account/bitget-status` 及 `?view=test`。原 BG handler 只移到 server 目錄並調整相對 import，邏輯沒有變更；函式總數維持 12。

Email 註冊會寄送登入連結；一般登入不自動建立新帳號。Magic Link 應在發起登入的同一瀏覽器、10 分鐘內開啟。Google 與 Email 回呼都驗證 PKCE，OAuth provider token 與 verifier 不送到前端 storage。session 向 provider 驗證身份後才顯示會員資料；刷新後也重新驗證。登出即使 provider 暫時失敗仍清除 OX Cookie。

## 本地驗證

```sh
npm ci --ignore-scripts
npm test
npm run check
node scripts/account-ui-check.mjs
npm run test:e2e
```

UI 測試使用獨立無頭瀏覽器及合成資料，不寄信、不建立帳號、不使用使用者已登入瀏覽器。可用 `OX_TEST_BROWSER` 指定已有的 Chromium 可執行檔。它檢查 Magic Link 註冊請求、Google 失敗恢復、會員資料跳脫、儲存狀態、登出與未設定時的訪客模式。

`GET /api/v1/account/config` 只確認環境設定形狀，不表示 Google 或資料庫已連通。真正驗收要在核准部署後，以使用者親自登入測試 Google、Email，確認 session 回傳登入身份及 `accountStorage=stored`，登出後身份清除。此輪未部署、未執行真實登入。

## 此輪結果（2026-10-01）

- 本機附件 SHA256：`501a61ade6d39ca70bf12b04fa216f3d8588c1b33e6c851002c6ddd86f224e49`，與上傳附件相同；未發現秘密檔案或已辨識的真實秘密格式。
- 完整單元測試 188/188 通過，其中帳號 14 項、BG 19 項；Build check 通過。
- 獨立帳號 UI 合成資料測試通過；整站桌機／390×844 手機回歸通過，手機 overflow 0px，沒有 console／page error。
- Production 唯讀檢查：`/api/v1/account/config` 仍是 HTTP 404，公開 `auth.js` 仍含 stub、沒有新 initialize，證實新帳號程式尚未發布。
- Supabase provider、真實 Google／Email 登入及既有會員表線上狀態尚未實測；没有重新執行 schema。

使用者核准發布後，帳號提交已接合至最新遠端 `9465695`，保留最新新聞、台股修復／搜尋詳情及 Crypto 泡泡圖。接合後完整單元測試 203/203 通過，Build check 通過（92 個資產、179 個唯一 ID、12 個 API function）；沒有帶入附件中較舊的市場程式或資料。
