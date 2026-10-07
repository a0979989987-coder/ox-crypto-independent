# 加密板塊與連續回放（2026-10-07）

- 24 個 OX 編輯觀察群組由 `sector-taxonomy.js` 定義。成分清單允許重疊；`FET/ASI` 先選已驗證 FET，否則 ASI。舊分類的 ARKM、MANTA、DIA、POLYX 留在原本相關群組，避免遺失原有追蹤標的。
- Bitget v3 線上加密 USDT 永續合約、相符 baseCoin 與正成交量 ticker 三項均通過才加入；每個群組需要至少兩筆完整的共同 K 線才能算出泡泡。選擇器展示 24 群及候選／已驗證數，畫布與排行只顯示有完整資料的群組。BTC 同時是 BTC／PoW 候選及相對報酬基準。重疊成分的成交占比不是全市場去重資金流。
- 冷啟動先讀記錄快照；背景共用行情排程低優先刷新並分批顯示。記錄快照由 `scripts/capture-crypto-tools.py` 擷取，和前端共用清單。若某筆行情失敗，留下錯誤和覆蓋數，不補零；下一次刷新可重試。
- 板塊輪動與主動買賣回放共用單一動畫時鐘，使用同一畫布以每幀補間位置、成交量對應的半徑與顏色。日期、排行及數值仍採真實完整期別；暫停後可續播，拖曳滑桿保留小數期別，切換或背景隱藏時取消動畫。
- 快照 `coins` 只保留先前記錄的 CoinGecko 市值及 `last_updated`，不將舊市值視為即時值；新成分沒有市值時沿用現有熱力圖的成交額或等大視圖。
- 本地可執行 `npm run build:tools && npm run check && npm test`。瀏覽器驗證：`npm run test:news-rotation`；CI 在 pull request 上會重跑。需要最新市場快照時，工作流程 `Capture crypto sector snapshot` 只上傳可檢查的 artifact，再明確加入此專案。
