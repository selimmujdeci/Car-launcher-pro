# ============================================================================
# hu-probe.ps1 — hu-probe.sh'i bir head unit'e push edip çalıştırır, raporu kaydeder.
# Kullanım:
#   .\tools\hu-probe.ps1 10.185.22.216:5555
#   (cihaz USB'de ise seri no ver; tek cihazsa parametre opsiyonel)
# Çıktı: tools\hu-report-<cihaz>.txt  (hem ekrana hem dosyaya)
# ============================================================================
param([string]$Device = "")

$adb = "C:/Users/selim/AppData/Local/Android/Sdk/platform-tools/adb.exe"
$sh  = Join-Path $PSScriptRoot "hu-probe.sh"
if (-not (Test-Path $sh)) { Write-Error "hu-probe.sh bulunamadı: $sh"; exit 1 }

$sel = @(); if ($Device) { $sel = @("-s", $Device) }

# Bağlantı (ağ üzerinden ise) — IP:port verildiyse connect dene
if ($Device -match ":\d+$") { & $adb connect $Device 2>&1 | Out-Null }

$state = (& $adb @sel get-state 2>&1)
if ($state -notmatch "device") { Write-Error "Cihaz hazır değil ($state). USB/WiFi + ACC açık mı?"; exit 1 }

Write-Host "Cihaza push ediliyor..." -ForegroundColor Cyan
& $adb @sel push $sh /data/local/tmp/hu-probe.sh 2>&1 | Out-Null

$safe = if ($Device) { $Device -replace '[:\.]','_' } else { "default" }
$out  = Join-Path $PSScriptRoot "hu-report-$safe.txt"

Write-Host "Tarama çalışıyor (root)..." -ForegroundColor Cyan
$report = & $adb @sel shell sh /data/local/tmp/hu-probe.sh 2>&1
$report | Tee-Object -FilePath $out
& $adb @sel shell rm /data/local/tmp/hu-probe.sh 2>&1 | Out-Null

Write-Host ""
Write-Host "Rapor kaydedildi: $out" -ForegroundColor Green
