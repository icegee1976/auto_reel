$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$ports = @(4100, 5173, 5174)
$listeners = Get-NetTCPConnection -LocalPort $ports -State Listen -ErrorAction SilentlyContinue |
  Select-Object -ExpandProperty OwningProcess -Unique

foreach ($processId in $listeners) {
  $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
  if ($process -and $process.ProcessName -eq "node") {
    Write-Host "Stopping old Auto Reel process on port(s): $($ports -join ', ')"
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
  }
}

if (-not (Test-Path "node_modules")) {
  npm install
}

npm run build

$env:NODE_ENV = "production"
$url = "http://127.0.0.1:4100"
$server = Start-Process -FilePath "node" -ArgumentList "server/index.js" -WorkingDirectory $PSScriptRoot -PassThru -WindowStyle Hidden

try {
  $ready = $false
  for ($i = 0; $i -lt 30; $i++) {
    try {
      Invoke-WebRequest -UseBasicParsing "$url/api/health" -TimeoutSec 1 | Out-Null
      $ready = $true
      break
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }

  if (-not $ready) {
    throw "Auto Reel server did not start on $url"
  }

  Write-Host ""
  Write-Host "Auto Reel is running:"
  Write-Host $url
  Write-Host ""
  Write-Host "Close this PowerShell window to stop the server."
  Start-Process $url
  Wait-Process -Id $server.Id
} finally {
  if ($server -and -not $server.HasExited) {
    Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
  }
}
