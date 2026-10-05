# OX：Bitget 推薦客戶註冊與認證查詢

## 本次完成範圍

後端串接程式完成；尚未用真實憑證驗證。正式 OX 登入、管理員 Session、會員資料庫與 UID 所有權驗證尚未接上。
這一版提供受保護的管理端 API 與本機查詢指令，不提供公開 UID 搜尋、不寫會員權限、不修改市場行情 API。

## 官方文件核對（2026-09-27）

- [使用者提供的 Classic 目錄](https://www.bitget.com/zh-CN/docs/classic/catalog)
- [代理商客戶接口](https://www.bitget.com/docs/catalog/classic-affiliate-customer-info/classic-affiliate-customerinfo)
- [API 建立與簽章](https://www.bitget.com/docs/classic/rest-api)

| 目的 | Bitget 方法及路徑 | 本模組行為 |
| --- | --- | --- |
| 指定 UID 的推薦關係與註冊時間 | POST `/api/v2/broker/customer-list` | 只查指定 UID，不傳註冊日期限制；支援舊客戶 |
| 認證狀態 | GET `/api/v2/broker/customer-kyc-result` | 指定 UID、`showSub=no`，明確傳入起訖毫秒時間，單次區間最多 90 天 |

官方文件說明：登入交易所後可到 API 管理建立金鑰。但「能建立金鑰」不保證該帳號擁有代理商資料的讀取權限。
請使用有對應推薦客戶關係的代理帳號，實際呼叫這兩個接口確認權限；若 Bitget 拒絕，依回傳代碼向 Bitget 確認，不靠增加交易或提幣權限解決。
本模組使用系統產生的 HMAC API Key，非使用者產生的 RSA Key。

認證接口約 5 分鐘更新，`passed` 包含 KYC 或 KYB，不能單靠這個接口分辨個人／企業認證。
省略起訖時間預設只查昨日（UTC+8），因此本模組預設明確查最近 90 天。
此結果描述指定查詢區間的回傳紀錄，不宣稱已驗證全部歷史或即時狀態。舊用戶查不到認證紀錄時，應選擇其他有效區間或向 Bitget 核實。

## 必要設定

在 Bitget 網站登入你的代理帳號 → 個人選單 → API 管理 → 建立系統產生的 API（HMAC）。
本用途僅查詢，使用最小讀取權限。不要啟用交易、划轉或提幣。
若金鑰設定 IP 白名單，請使用實際後端的固定出口 IP；不要把 Vercel 網域的解析 IP 當成出口 IP。

在 Vercel 的 OX 專案 → Settings → Environment Variables 加入下列設定，然後重新部署：

| 變數 | 內容 |
| --- | --- |
| `BITGET_AFFILIATE_API_KEY` | Bitget 產生的 API Key |
| `BITGET_AFFILIATE_SECRET_KEY` | 同一把金鑰的 Secret Key |
| `BITGET_AFFILIATE_PASSPHRASE` | 建立該 API 時自行設定的口令，不是交易所登入密碼 |
| `BITGET_AFFILIATE_REFERRAL_CODE` | 選填；限定特定推薦碼。不設定代表此 API 帳號的直客關係 |
| `OX_ACCOUNT_LOOKUP_TOKEN` | OX 管理端查詢專用的隨機長字串，至少 32 字元；不是 Bitget 金鑰 |

金鑰、Secret、Passphrase 與查詢 Token 均僅放伺服器環境變數；不要貼聊天、前端、GitHub 或瀏覽器儲存。
可在你自己的終端機執行 `openssl rand -hex 32` 產生真正的管理端查詢 Token，再填入 Vercel。
HTTP 路由在沒有足夠長度的 Token 時一律停用，未授權請求不會碰觸 Bitget。
Token 是伺服器維運用途，不能當作會員登入或放入管理頁的 JavaScript。

## 查詢方式

### 本機（不用管理端 Token）

在未納入 Git 的 `.env.local` 填入前三項 Bitget 憑證。Node.js 20.6+：

```sh
node --env-file=.env.local scripts/check-bitget-customer.mjs YOUR_CUSTOMER_UID
```

可選擇指定認證查詢區間：在 UID 後加入開始與結束毫秒時間戳記，跨度不得超過 90 天。
請使用一個你確認屬於該代理帳號的客戶 UID 測試；代理本人 UID 不一定是自己的直客。
指令只輸出指定 UID 的最少結果或已遮蔽細節的錯誤，不輸出 Secret、簽章或上游原始訊息。

### Vercel 後端 API

`POST /api/v1/account/bitget-status`

- `Authorization: Bearer <OX_ACCOUNT_LOOKUP_TOKEN>`
- `Content-Type: application/json`
- JSON body：`uid`（字串），可選 `startTime`、`endTime`（須同時提供的毫秒時間戳記字串）。
- 不接受 URL 中的 UID／Token，不開放跨站瀏覽器 CORS，不快取個資回應。
- `npm run dev` 僅提供靜態預覽；該路由須在 Vercel Node Functions 執行。
- 沒有全域分散式限流或批次同步；目前僅供低頻單 UID 維運查詢。遇到 Bitget 429 會停止並回報，不自動循環重試。

## 回傳語意

- `referral.status=matched`：在此代理／指定推薦碼的直客列表找到 UID。
- `registration.status=observed`：該直客存在，`registeredAt` 是可解析的註冊時間；API 缺值時保留 null。
- `referral.status=not_found`：沒有在查詢範圍找到推薦關係，**不能判定全站沒有這個 Bitget 帳號**。
- `certification.status=passed / not_passed`：Bitget 明確回傳的 KYC／KYB 結果。
- `unknown`：沒有區間內紀錄、未知列舉值或互相衝突的結果；不能當作未通過，也不能授權。
- `not_checked`：未找到推薦關係，未繼續查認證。
- API 或簽章失敗：HTTP 非成功回應；不合成 `passed` 或 `not_passed`。
- `accountBindingVerified=false`：查到某個 UID 不代表目前 OX 使用者擁有它。
- `accessPolicyChanged=false`：沒有啟用任何會員限制或 CRYPTO_FULL 權限。

未來接入會員時，先完成真實 OX Session、可靠的 UID 所有權證明與唯一綁定，再由後端讀寫認證資料。
不能把本維運 Token 嵌入前端程式或瀏覽器儲存，也不能因訪客輸入一個通過認證的 UID 就幫他解鎖。

## 手機維運測試頁（2026-09-29）

入口：`/api/v1/account/bitget-status?view=test`。共用既有函式，不增加 Vercel 函式數量。這是獨立維運工具，不是 OX Account 的正式會員登入。
管理者手動輸入既有 `OX_ACCOUNT_LOOKUP_TOKEN`，透過 HTTPS 原生表單提交給同源後端。
密碼不嵌入 HTML／JavaScript、不回顯、不寫入 localStorage／sessionStorage；Bitget 三項憑證仍只在伺服器。
後端驗證後簽發 10 分鐘、限定測試路徑的 Secure / HttpOnly / SameSite=Strict Cookie，後續 UID 查詢不再傳送原始維運 Token。
每次操作檢查同源 Origin，查詢與登出另驗證 CSRF nonce。頁面沒有 JavaScript、第三方資源或追蹤，回應禁止快取與嵌入。
登入／查詢各有每執行個體每分鐘 5 次的突發限制；這不是分散式全域限流。
登出清除本機 Cookie；簽發的授權最遲 10 分鐘失效，輪替維運 Token 會使既有 Cookie 失效。
此入口採服務端渲染：只有管理者手動輸入密碼的表單會短暫接觸原始 Token，沒有把 Token 交給應用程式腳本。
登入後使用有權查詢的直客 UID。認證目前查最近 90 天；未找到紀錄仍顯示無法確認，不變更會員權限。
正式 Bitget 聯通結果仍須由有效憑證與授權測試 UID 的實際請求確認，模擬測試不能代替。
