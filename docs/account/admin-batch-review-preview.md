# 代理批次審核：本地測試版

此版本位於同一 OX repository，未接入正式 Account API、未部署、未套用正式 schema、未建立真實管理員，也不修改現有公開功能或 Bitget 查詢。

## 啟動與驗收

```sh
node scripts/admin-review-preview.mjs --ordinary-fixture
```

完整流程驗收指令使用 `--ordinary-fixture` 明確啟用合成功能；不加這個旗標的預設模式，普通代理權益為未設定，核准會回報 ORDINARY_POLICY_UNCONFIGURED、不授權。

以使用者電腦瀏覽器開啟 `http://127.0.0.1:4199/`。服務只綁定 loopback，拒絕其他 Host／Origin，在 Vercel 或 NODE_ENV=production 拒絕啟動。使用獨立 PGlite 記憶體資料庫；停止或重新啟動就清除所有測試資料。

1. 按「模擬管理員」及「載入合成範例」，整理比對。範例三個 UID 與使用者提供的真實格式示例無關。
2. 9000000001 匹配一人；9000000002 匹配兩位申請者，必須選定一人；9000000003 無會員，必須明確排除，不能建立可搶領白名單。
3. 每筆指定普通／核心代理，打開確認窗核對會員 UUID、UID、等級與預覽權益，填寫理由後確認本地核准。
4. 核准紀錄與 audit 顯示人工來源。按撤銷並填理由；只撤掉該筆人工核准。普通與核心代理都不能開後台。
5. 切換一般會員／未登入，再查詢會被後端拒絕。UI 不保留前管理員的資料。

核心預覽 capability 為 `all_member_features`，不包含管理權。普通預覽**預設未設定**；只有明確選用測試旗標才使用 `fixture_partial_feature`；可在服務建立時指定其他 `fixture_*` 合成功能，以驗證不同矩陣，不能把它當正式功能規則。普通政策空白時拒絕核准。policy version 不符時必須重新核對。

## 後端與資料一致性

- HTTP session 僅為本地合成模式：使用隨機、短效 HttpOnly Cookie 的伺服器端對照表。選擇模擬身分不是正式登入或正式管理員建立。
- `validateIdentity` 是可注入且可信的認證邊界；後端仍須查 private 管理員名單，不讀 Email、前端角色或 user_metadata 來授權。移除管理員後，連 idempotent replay 都拒絕。
- lookup 回傳所有匹配者；approve 只接受明確 account UUID、UID、claim revision、level。不接受自帶 scopes、actor、verified 或權益。無匹配、過時 revision 與既有 active approval 均逐筆回報，成功項目不包含失敗項目。
- 一個 UID／會員最多一個 active 人工核准是本地的安全提案；待驗證 UID 仍允許多人申請。已有 active 核准要變更等級須先撤銷、再核准。
- 核准及稽核、batch receipt 同一交易；稽核寫入失敗則全部 rollback。idempotency key 綁定管理員及完整 payload，重送不重複寫入，更改 payload 使用同 key 則 conflict。重送回覆是原請求收據，不能當成當前有效權益。
- effective 每次將 approval UID／revision 與 live claim 比對，移除／重綁立即失效；管理員讀取紀錄或下一次核准時才在本地同步 invalidated audit。正式版應改用 mutation hook／受控 reconciliation，不依賴 GET 做同步。
- 人工核准保留 ownership_verified=false，從不改寫原 pending claim 或 Bitget 官方 KYC／代理結果。撤銷不刪稽核紀錄，也不涉及其他來源的會員權益。
- 私有 schema／table／sequence 明確撤銷 PUBLIC、anon、authenticated 權限，所有表開 RLS。測試包括既有 default grants 的情境。

## 測試

```sh
node --test tests/admin-review*.test.mjs
node scripts/admin-review-ui-check.mjs
npm test
npm run check
node scripts/account-ui-check.mjs
```

PGlite 是真正的本地 PostgreSQL/WASM，使用合成 auth／會員。單一連線的 transaction queue 與 concurrent request 測試**不證明**正式多連線的鎖定／unique violation 處理。正式發布前仍需 Supabase 測試環境驗證。

## 正式串接草案及發布阻礙

`admin-review-schema-draft.sql` 僅供本地設計驗證，不是可直接套用的 migration。未授予任何 client 私有資料存取權，未定義正式 mutation RPC。

正式版需沿用現有 OX provider 驗證的 session；以 user JWT 呼叫窄範圍、DB 端核驗 auth.uid() 與 private 管理員名單的 RPC。不得新增／搬運 service-role key。首次管理員須由使用者明確選定既有 OX UUID，再以獨立受控維運步驟建立；應用程式不提供自助升權。

RPC 必須鎖定選定 claim，使用共用的 member advisory lock，按固定順序鎖 UID，DB unique index 保護 active approvals。逐筆 business conflict 清楚回報，任何 SQL／audit 故障不得留下缺少稽核的核准。正式 audit 使用只能新增的非 owner 路徑，既有資料不得改寫。管理員撤銷、UID mutation 與權益讀取都需即時生效。

若最後要授予功能，正式 backend 需將這個人工來源與既有 ox_service_entitlements 整合、限定 capability catalog／普通矩陣及 policy version；保持目前公開功能開放，不能靠前端標籤或 core 等級擴張管理權。

最後一次驗收需要確認：普通代理可用的功能清單、首位管理員的既有 OX Account UUID，以及是否接受每個 UID 只允許一個 active 人工核准會員。核心預覽為全部會員功能；正式 DB／管理員建立／真實核准／發布仍需具體授權。

## 最終 QA（2026-10-02）

- 完整單元／本地 PostgreSQL／HTTP 測試 396/396 通過，無 skip；其中本次新增 24 項。
- 本地完整 UI 流程、390×844 手機零水平溢出、audit 文字跳脫、延遲 lookup／records 及身分切換窗口測試通過。
- 原 Account UI 回歸通過；build 通過（95 local assets、172 unique IDs）。
- 獨立只讀安全審查及修正後複查通過，結論只限本地合成測試版可交付。
- 未重新宣稱既有全站 E2E／歷史 extraction 成功：前者已在原 main 與入口修復分支同樣卡 T1 容量，後者缺少 ed8df7a 歷史提交。本次沒有修改那些程式。
- 沒有推送、PR、部署、正式 DB 操作、真實 admin bootstrap 或真實會員權益變更。BG 後端、正式 Account dispatcher、index、市場程式與依賴檔均零 diff。


## SQL／RPC 發布候選（未套用正式環境）

目前預覽已使用 `supabase/migrations/20261002033814_ox_admin_review_candidate.sql` 的 SQL RPC、RLS 與觸發器；初版 JavaScript mock 僅保留回歸測試。正式傳輸使用既有 Account cookie → Supabase getUser 驗證 → 原會員 JWT 的 RPC，沒有 service-role 升權。非 localhost 預覽不提供測試登入入口。

SQL 預設空管理員、普通權益未設定、人工核准不證明 UID 持有權；不改既有公開功能。既有 executor 必須無敏感 role attributes，且 anon/authenticated 不可直接或間接取得該 role。稽核、核准與 receipt 同交易；UID 重綁立即失效。

驗證分開記錄：完整 Node 測試 403 項；原生 PostgreSQL 17.11 原生測試 16 項（含惡意既有角色、真實鎖等待、競爭核准、重綁、撤銷、移除管理員、稽核失敗 rollback）。SDK 測試使用真正 Supabase SDK，provider 回應及 JWT 是合成測試資料；不代表正式 OAuth／Email 測通。Google 正式成功沿用先前已驗證成果，Email 正式尚未測。

原生測試：`node --test tests/admin-review.native.mjs tests/admin-review-migration.native.mjs`，只接受 127.0.0.1:55439、專用 `task-2/imports/postgres-tools/candidate-data` cluster；建立／刪除自己的隨機測試 database。不得指向正式 Supabase。工具來自 PostgreSQL 官方 Windows 頁面的 EDB 17.11 binary，未建立系統服務。

正式發布仍需決定普通權益矩陣、首位管理員 UUID、是否維持一 UID 一有效核准；已在本地 PostgreSQL 17.11 驗證非 superuser、NOINHERIT、NOBYPASSRLS 的 database owner migration role 可完整套用；需要 CREATEROLE 及 executor 的顯式 ADMIN／SET membership，不能由一般 authenticated／anon 執行。這是本地權限模型驗證，不宣稱已測正式 Supabase postgres 角色。熱門 UID 結果超過 1000 筆整批拒絕 TOO_MANY_MATCHES，不截斷成唯一會員。候選尚未 push、merge、部署或套用正式 schema。原市場 E2E／extraction 既有基線問題不列為通過。

目前可開啟候選 SQL 預覽 http://127.0.0.1:4203/（synthetic sessions、PGlite 執行同一 SQL；原生 PostgreSQL 競爭／角色驗證另跑，未接正式 provider）。

最新 main 相容性：origin/main 3d96951679cdb9be627fc0459dac0d6bd5a82a68 與候選以 git merge-tree 無衝突整合至獨立 imports/admin-main-compat（不變動任一 branch／市場 checkout）；合併快照完整測試 421／421、build 96 assets／171 IDs、Account 與後台 UI 全通過。原候選測試403／403、native16／16。
