---
name: git-sync
description: Commit and push the current project to GitHub. Use this skill whenever the user wants to sync, save, push, commit, or upload their project to GitHub — even if they just say "幫我存到 GitHub", "push 上去", "sync", "commit", or "上傳". Always invoke this skill proactively when the user finishes a task and might want to save their progress.
---

# Git Sync

幫使用者將目前專案的變更 commit 並推送到 GitHub。

## 執行步驟

### 1. 確認有無變更

```bash
git status
```

如果沒有任何變更（working tree clean），告知使用者「目前沒有新的變更需要同步」，結束流程。

### 2. 顯示變更摘要

列出將被加入的檔案，讓使用者知道這次會 commit 什麼內容。

### 3. 詢問 commit message

請使用者輸入這次的 commit 說明，例如：

> 「這次修改了什麼？請輸入 commit 說明（直接按 Enter 使用預設：update）」

如果使用者沒有輸入，使用預設值 `update`。

### 4. 執行 git 指令

```bash
# 加入所有變更
git add .

# commit（使用使用者輸入的 message）
git commit -m "使用者輸入的 message"

# 推送到遠端
git push
```

> **注意**：若系統找不到 gh CLI，路徑在：
> - Bash：`/c/Program Files/GitHub CLI`
> - PowerShell：`C:\Program Files\GitHub CLI`
> 若 `git push` 失敗，嘗試 `git push -u origin main`

### 5. 確認成功

推送成功後，顯示 GitHub repo 網址（從 `git remote get-url origin` 取得），告知使用者同步完成。

## 錯誤處理

- **未設定 remote**：提示使用者先執行 `git remote add origin <GitHub網址>`
- **未登入 gh**：提示執行 `gh auth login`
- **branch 名稱不符**：嘗試 `git push -u origin HEAD`
- **有衝突**：告知使用者需要先手動解決衝突
