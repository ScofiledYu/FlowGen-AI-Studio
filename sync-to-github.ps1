# 在开发目录运行：同步到 _fg_push_repo 并提示后续 git 命令
$ErrorActionPreference = 'Stop'
$PushRepo = 'd:\aaa\_fg_push_repo'
$Script = Join-Path $PushRepo 'sync-from-dev.ps1'

if (-not (Test-Path $Script)) {
  throw "未找到推送仓库脚本: $Script"
}

& $Script
Set-Location $PushRepo
& 'C:\Program Files\Git\bin\git.exe' status -sb
