@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo   敦煌项目 Git 关联脚本
echo ============================================
echo.
echo 当前目录: %CD%
echo.

REM 设置项目根目录
set "PROJECT_DIR=C:\Users\wang xiaozheng\Desktop\project_files\dunhuang\DH_web"
set "GIT_URL=https://github.com/Einstein233/Dunhuang.git"

cd /d "%PROJECT_DIR%"

REM ============================================
REM 步骤1: 删除旧 WeatherVisualization 的 git 历史
REM ============================================
echo [步骤 1/4] 清理旧的 WeatherVisualization git 历史...
if exist "WeatherVisualization\.git_disabled" (
    rmdir /s /q "WeatherVisualization\.git_disabled"
    echo   ✓ 已删除 WeatherVisualization\.git_disabled
) else (
    echo   - WeatherVisualization\.git_disabled 不存在，跳过
)
echo.

REM ============================================
REM 步骤2: 克隆远程仓库获取 .git
REM ============================================
echo [步骤 2/4] 从远程仓库获取 .git 历史...
set "TEMP_DIR=%TEMP%\dh_temp_clone"

if exist "%TEMP_DIR%" (
    rmdir /s /q "%TEMP_DIR%"
)

echo   正在克隆 %GIT_URL% ...
git clone "%GIT_URL%" "%TEMP_DIR%" 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo   ✗ 克隆失败！请检查：
    echo     1. Git 是否已安装
    echo     2. 网络是否能访问 GitHub
    echo     3. 仓库 URL 是否正确: %GIT_URL%
    pause
    exit /b 1
)
echo   ✓ 克隆成功

echo   正在复制 .git 目录到项目根目录...
xcopy /e /i /h /y "%TEMP_DIR%\.git" "%PROJECT_DIR%\.git" >nul
if %ERRORLEVEL% NEQ 0 (
    echo   ✗ 复制失败！
    pause
    exit /b 1
)
echo   ✓ .git 已复制到项目根目录

echo   清理临时文件...
rmdir /s /q "%TEMP_DIR%"
echo   ✓ 临时文件已清理
echo.

REM ============================================
REM 步骤3: 查看状态和差异
REM ============================================
echo [步骤 3/4] 查看本地改动...
cd /d "%PROJECT_DIR%"

REM 切到 main 分支（如果远程用的是 main）
git checkout main 2>nul || git checkout master 2>nul

echo.
echo --- Git 状态 ---
git status
echo.
echo --- 远程仓库最后 3 条提交 ---
git log --oneline -3
echo.

REM ============================================
REM 步骤4: 提交和推送
REM ============================================
echo [步骤 4/4] 提交并推送...
echo.
echo 以上是本地相对于远程的所有改动。
echo.
set /p CONFIRM="是否继续提交并推送？(y/n): "
if /i not "%CONFIRM%"=="y" (
    echo 已取消。你可以手动执行:
    echo   git add -A
    echo   git commit -m "你的提交信息"
    echo   git push origin main
    pause
    exit /b 0
)

echo.
echo   正在 add 所有文件...
git add -A

echo   正在 commit...
git commit -m "整合项目: 后端/前端/大屏/服务模块, 清理冗余git历史, 添加启动脚本和文档"

echo   正在 push 到 origin...
git push -u origin main 2>nul || git push -u origin master 2>nul

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ============================================
    echo   ✓ 全部完成！
    echo ============================================
    echo   Git 已关联，改动已推送到远程仓库
) else (
    echo.
    echo   ✗ Push 失败。可能需要：
    echo     1. 检查 GitHub 登录状态
    echo     2. 使用 git push -u origin HEAD
)

pause
