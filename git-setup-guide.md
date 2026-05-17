# 敦煌项目 Git 关联指南

## 当前状态分析

通过对 DH_web 文件夹的完整扫描，发现以下情况：

| 检查项 | 状态 |
|--------|------|
| DH_web 根目录 .git | ❌ 不存在 — 项目未关联 Git |
| 根目录 .gitignore | ✅ 已配置 — 排除了 node_modules、dist、SQL、日志等 |
| WeatherVisualization/.git | ❌ 有一个 `.git_disabled`（改名禁用的 .git），指向 `Augustuswxz/WeatherVisualization.git`（旧仓库） |
| 其他子目录 .git | ❌ 均无独立 git 追踪 |

## 操作原理

你从 GitHub 下载了代码但没有 `git clone`（可能是 Download ZIP），所以没有 `.git` 目录。现在需要：

1. **获取远程的 .git 历史** — 通过临时 clone 拿到 `.git`
2. **放到本地项目** — 把 `.git` 复制到 DH_web 根目录
3. **Git 自动检测差异** — `git status` 会显示你所有本地改动
4. **提交并推送** — 保存改动到云端

## 方法一：一键脚本（推荐）

双击运行项目根目录下的 **`setup-git.bat`**，按提示操作即可。

## 方法二：手动执行

在项目根目录 `DH_web` 下打开终端（PowerShell 或 Git Bash），逐步执行：

### 步骤 1：删除旧的 WeatherVisualization git 历史

```powershell
Remove-Item -Recurse -Force "WeatherVisualization\.git_disabled" -ErrorAction SilentlyContinue
```

### 步骤 2：获取远程仓库的 .git

```bash
# 克隆到临时目录
git clone https://github.com/Einstein233/Dunhuang.git C:\Temp\dh_temp

# 复制 .git 到项目根目录
xcopy /E /I /H /Y C:\Temp\dh_temp\.git .git

# 删除临时目录
rmdir /S /Q C:\Temp\dh_temp
```

### 步骤 3：查看改动

```bash
git checkout main    # 或 master，取决于远程默认分支
git status           # 查看所有本地改动
git log --oneline -5 # 查看远程最近提交
```

### 步骤 4：提交并推送

```bash
git add -A
git commit -m "整合项目: 后端/前端/大屏/服务模块, 清理冗余git历史"
git push -u origin main
```

## 注意事项

1. 确保已安装 Git 并配置了 GitHub 登录凭证
2. 如果远程默认分支是 `master` 而非 `main`，将上述命令中的 `main` 替换为 `master`
3. `.gitignore` 已正确配置，node_modules 等大文件不会被提交
4. WeatherVisualization 的旧 git 历史（`.git_disabled`）已被清理，所有文件统一在一个仓库管理
