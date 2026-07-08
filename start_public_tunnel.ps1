$ErrorActionPreference = "Stop"

$workdir = "E:\Work\Documents\GEO搜索"
$python = "C:\Users\huawei\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$cloudflaredDir = Join-Path $workdir ".cloudflared-bin"
$cloudflaredExe = Join-Path $cloudflaredDir "cloudflared.exe"
$cloudflaredLog = Join-Path $cloudflaredDir "cloudflared.log"
$downloadUrl = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"

New-Item -ItemType Directory -Force -Path $cloudflaredDir | Out-Null

if (-not (Test-Path $cloudflaredExe)) {
  Write-Host "Downloading cloudflared..."
  Invoke-WebRequest -Uri $downloadUrl -OutFile $cloudflaredExe
}

$serverRunning = Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "python.exe" -and $_.CommandLine -like "*server.py*" }

if (-not $serverRunning) {
  Write-Host "Starting shared app server..."
  Start-Process -FilePath $python -ArgumentList "server.py" -WorkingDirectory $workdir -WindowStyle Hidden
  Start-Sleep -Seconds 2
}

Get-CimInstance Win32_Process |
  Where-Object { $_.Name -eq "cloudflared.exe" -and $_.ExecutablePath -eq $cloudflaredExe } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force }

if (Test-Path $cloudflaredLog) {
  Remove-Item $cloudflaredLog -Force
}

Write-Host "Starting temporary public tunnel..."
Start-Process -FilePath $cloudflaredExe `
  -ArgumentList "tunnel", "--url", "http://127.0.0.1:8000", "--no-autoupdate", "--logfile", $cloudflaredLog `
  -WorkingDirectory $cloudflaredDir `
  -WindowStyle Hidden

$publicUrl = $null
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $cloudflaredLog) {
    $content = Get-Content $cloudflaredLog -Raw
    $match = [regex]::Match($content, 'https://[-a-z0-9]+\.trycloudflare\.com')
    if ($match.Success) {
      $publicUrl = $match.Value
      break
    }
  }
}

if (-not $publicUrl) {
  Write-Host "Tunnel started, but no public URL was detected yet."
  Write-Host "Check log:"
  Write-Host $cloudflaredLog
  exit 1
}

Write-Host ""
Write-Host "Public URL:"
Write-Host $publicUrl
Write-Host ""
Write-Host "This is a temporary address and may change after restart."
