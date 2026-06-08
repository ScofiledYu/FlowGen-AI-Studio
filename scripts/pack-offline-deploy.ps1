# 打离线部署包到 D:\software\flowgen-offline.zip
# 用法: powershell -ExecutionPolicy Bypass -File scripts\pack-offline-deploy.ps1
param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [string]$SoftwareDir = 'D:\software'
)

$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force -Path $SoftwareDir | Out-Null
Set-Location $ProjectRoot

Write-Host '[pack] npm ci...'
npm ci
Write-Host '[pack] npm run build...'
npm run build

foreach ($p in @('dist\index.html', 'server\flowgen\routes.mjs', 'scripts\mysql-init-schema.mjs', 'node_modules\mysql2\package.json')) {
  if (-not (Test-Path $p)) { throw "缺少: $p" }
}

$OutZip = Join-Path $SoftwareDir 'flowgen-offline.zip'
if (Test-Path $OutZip) { Remove-Item $OutZip -Force }

$7z = @('C:\Program Files\7-Zip\7z.exe', 'C:\Program Files (x86)\7-Zip\7z.exe') | Where-Object { Test-Path $_ } | Select-Object -First 1
$items = @('server.js', 'promptPlaceholders.mjs', 'package.json', 'package-lock.json', 'dist', 'server', 'scripts', 'node_modules', '.env.example')

if ($7z) {
  Write-Host "[pack] 7z -> $OutZip (约 1～3 分钟)..."
  & $7z a -tzip -mx=5 $OutZip @items | Out-Null
} else {
  Write-Host "[pack] Compress-Archive -> $OutZip (较慢)..."
  Compress-Archive -Path $items -DestinationPath $OutZip -CompressionLevel Fastest -Force
}

$envTxt = Join-Path $SoftwareDir 'env.local.txt'
if (Test-Path (Join-Path $ProjectRoot '.env.local')) {
  Copy-Item (Join-Path $ProjectRoot '.env.local') $envTxt -Force
}

$mb = [math]::Round((Get-Item $OutZip).Length / 1MB, 2)
Write-Host "[pack] 完成: $OutZip (${mb} MB)"
Write-Host "[pack] 配置模板: $envTxt"
