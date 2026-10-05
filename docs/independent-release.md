# OX 加密獨立版交付紀錄

來源：`a0979989987-coder/ox-crypto-screener` 的 `main`，提交 `0c193666f65f51022f02a99d81d4ba6454cfa949`。原專案未修改。新儲存庫：`a0979989987-coder/ox-crypto-independent`。

## 保留與移除

完整保留 `src/markets/crypto`，以及既有圖表、帳號認證與後端核心。`crypto-source-parity.json` 記錄 71 份與原版逐位元相同的檔案，可用 `npm run verify:extraction` 檢查。原版雷達、即時 K 線、畫線、型態畫板、泡泡、強弱、熱力、輪動、主動買賣、新聞行事曆、媒體、設定與帳號入口均保留。

移除台股市場註冊、切換入口、功能搜尋、前後端模組、資料快照及更新排程。新聞來源、事件、資產資料只保留加密範圍，原本同時適用兩個市場的國際事件投影至加密。資料庫相容性需要的既有功能 ID 與遷移 SQL 保留；Account 和 Admin 畫面只列出 11 個現行功能。

原本共用但放在台股目錄的工具切換列樣式，原樣搬至 `src/styles/components/tools-rail.css` 與 `tools-rail-light.css`，保留排版、深淺色與動畫；沒有保留台股功能模組。重新產生 runtime 和 pattern worker。

## 已完成驗證

| 檢查 | 結果 |
| --- | --- |
| `npm run build:tools` | 通過 |
| `npm run check` | 通過，100 個本機資產、171 個唯一 ID |
| `npm run verify:extraction` | 通過，71 份核心檔案與來源一致，台股模組目錄不存在 |
| `npm test` | 340 項全部通過，無跳過 |
| `npm run test:e2e` | 深色／淺色 × 390／1440 px；雷達、6 個加密工具、新聞、行事曆、媒體及 Account 入口通過；無台股請求、無 JS 執行錯誤、無本機 HTTP 錯誤、無水平溢出 |
| `scripts/crypto-progressive-ui-check.mjs` | 6 情境通過，單一幣種請求停滯、worker 失敗時仍逐步顯示其餘掃描卡片 |
| `scripts/crypto-preload-ui-check.mjs` | 公開畫板預載與快取通過，受保護畫板不預載 |
| `scripts/account-entry-ui-check.mjs` | 手機／桌面的真實選單事件開啟 Google／Email 入口，關閉恢復焦點 |
| `scripts/admin-review-production-ui-check.mjs` | 真實 API 路由與驗證程式、SDK、RLS SQL；訪客／非管理員阻擋、核准、撤銷、稽核與手機介面通過 |

瀏覽器操作與認證測試使用明確合成行情、提供者與帳號工作階段，沒有送出真實 OAuth 授權、Email 或管理員決策。逐步顯示測試在約 3–4.4 秒出現部分卡片，這是受控測試結果，不是正式行情速度保證。

## 尚未完成的正式連線

新站尚未部署或設定後端環境變數。自動核准審查拒絕開啟原站 Vercel 環境變數頁，因該頁可能接觸私人金鑰；沒有讀取、複製或將金鑰上傳 GitHub。因此真實登入、會員資料、Admin 連線尚未驗證。

後續需要將原後端設定安全配置到新 Vercel 專案，指定新 `OX_ACCOUNT_ORIGIN`，並允許新站的認證回呼。不得停用原來的認證、功能權限或管理員檢查。
