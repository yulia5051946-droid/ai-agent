# Garena BD 財法務合約追蹤平台

## 目前完成內容

Next.js 14 全端應用程式，包含：

- **Google OAuth 登入**：限 @garena.com 和 @sea.com 帳號
- **合約總覽**：讀取 Gmail 所有 [合約審閱] 郵件串，AI 分析後顯示狀態、逾期警示、篩選搜尋
- **合約詳情**：AI 分析摘要、郵件時間軸、Google Sheets 即時資料、財務資訊、手動鎖定
- **郵件查詢**：輸入 GR 編號即時分析
- **財務追蹤**：金流、付款確認、發票狀態
- **每日日報**：09:00 台灣時間自動寄送（SMTP）
- **Docker 部署**：含 docker-compose.yml

## 待辦事項

- [ ] 在 Google Cloud Console 建立 OAuth 憑證
- [ ] 設定 .env.local（參考 .env.local.example）
- [ ] `npm install` 安裝相依套件
- [ ] 開發：`npm run next:dev`
- [ ] 部署：`docker-compose up -d`

## 重要規則

- 郵件原文不儲存，只存 AI 分析結果
- Google Sheets 每次即時讀取，不存副本
- 合約取消整列灰色，預設隱藏
- 手動鎖定狀態 AI 不覆蓋
- 日報 09:00 台灣時間（Asia/Taipei）發送

## 技術架構

```
Next.js 14 + TypeScript + Tailwind CSS
Gmail API + Sheets API（google OAuth per-user）
Claude API（claude-sonnet-4-6）分析郵件
SQLite（better-sqlite3）存分析快取 + 手動鎖定
node-cron 日報排程
Docker 部署
```
