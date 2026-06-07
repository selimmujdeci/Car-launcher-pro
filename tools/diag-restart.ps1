<#
  diag-restart.ps1 — CockpitOS self-restart kök neden teşhis aracı
  ----------------------------------------------------------------
  Amaç: Head unit üzerinde 1-5dk'da bir yaşanan self-restart loop'un
        sebebini KESİN ayırt etmek: OOM (LMK) mi / ANR mı / WebView
        renderer death mi / native crash mı?

  Gereksinim: PC'ye USB veya kablosuz adb ile bağlı head unit.
              Head unit'te ROOT GEREKMEZ.

  Kullanım (PowerShell):
      cd "C:\Users\selim\Desktop\caros pro\tools"
      .\diag-restart.ps1                 # varsayılan 20dk izler
      .\diag-restart.ps1 -Minutes 30     # 30dk izler
      .\diag-restart.ps1 -IntervalSec 10 # bellek örnekleme aralığı

  Çıktı: tools\diag-output\ altına 3 dosya
      - logcat-full.txt      : filtreli ham logcat (crash/ANR/OOM/renderer)
      - meminfo-timeline.csv : zaman / PID / TOTAL_PSS_MB (leak grafiği için)
      - events.txt           : restart anları + teşhis özeti (ÖNCE BUNU OKU)

  Bittiğinde: events.txt'i bana (Claude) geri getir.
#>

param(
  [int]$Minutes = 20,
  [int]$IntervalSec = 15,
  [string]$Package = "com.cockpitos.pro"
)

$ErrorActionPreference = "Stop"

# --- adb bul ---
$adb = (Get-Command adb -ErrorAction SilentlyContinue).Source
if (-not $adb) {
  $sdkCandidates = @(
    "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe",
    "$env:ProgramFiles\Android\Android Studio\platform-tools\adb.exe",
    "$env:USERPROFILE\AppData\Local\Android\Sdk\platform-tools\adb.exe"
  )
  foreach ($c in $sdkCandidates) { if (Test-Path $c) { $adb = $c; break } }
}
if (-not $adb) {
  Write-Host "HATA: adb bulunamadi. Android SDK platform-tools'u PATH'e ekleyin." -ForegroundColor Red
  exit 1
}
Write-Host "adb: $adb" -ForegroundColor Cyan

# --- cihaz bagli mi ---
$devices = & $adb devices | Select-String -Pattern "\tdevice$"
if (-not $devices) {
  Write-Host "HATA: Bagli cihaz yok. 'adb devices' ile kontrol edin (USB hata ayiklama acik mi?)." -ForegroundColor Red
  exit 1
}
Write-Host ("Bagli cihaz: {0}" -f ($devices.Line.Trim())) -ForegroundColor Green

# --- cikti klasoru ---
$outDir = Join-Path $PSScriptRoot "diag-output"
if (-not (Test-Path $outDir)) { New-Item -ItemType Directory -Path $outDir | Out-Null }
$logFile    = Join-Path $outDir "logcat-full.txt"
$memFile    = Join-Path $outDir "meminfo-timeline.csv"
$eventsFile = Join-Path $outDir "events.txt"

# Onceki ciktilari temizle
Remove-Item $logFile, $memFile, $eventsFile -ErrorAction SilentlyContinue
"timestamp,pid,total_pss_mb,java_heap_mb,native_heap_mb" | Out-File -FilePath $memFile -Encoding utf8

function Write-Event($msg) {
  $line = "[{0}] {1}" -f (Get-Date -Format "HH:mm:ss"), $msg
  Write-Host $line -ForegroundColor Yellow
  $line | Out-File -FilePath $eventsFile -Append -Encoding utf8
}

Write-Event "=== TESHIS BASLADI === paket=$Package, sure=${Minutes}dk, ornek=${IntervalSec}sn"

# --- logcat'i temizle ve arka planda filtreli kaydet ---
& $adb logcat -c
Write-Event "logcat temizlendi, arka plan kaydi basliyor..."

# Filtre: crash, ANR, OOM/LMK, WebView renderer death, native sinyaller, uygulama tag'leri
$logcatJob = Start-Job -ScriptBlock {
  param($adbPath, $out)
  & $adbPath logcat -v threadtime "*:I" |
    Select-String -Pattern "cockpitos|MainActivity|AndroidRuntime|FATAL|ANR |am_anr|lowmemorykiller|ActivityManager.*died|render_process_gone|RenderProcessGone|libc|SIGSEGV|SIGABRT|OutOfMemory|tombstone|Process .* has died|killed|Background concurrent|GC freed" |
    ForEach-Object { $_.Line | Out-File -FilePath $out -Append -Encoding utf8 }
} -ArgumentList $adb, $logFile

# --- ilk PID ---
function Get-Pid {
  $p = (& $adb shell pidof $Package 2>$null)
  if ($p) { return ($p -split "\s+")[0].Trim() }
  return $null
}

$lastPid = Get-Pid
if ($lastPid) { Write-Event "Baslangic PID = $lastPid" }
else { Write-Event "UYARI: Uygulama su an calismyor (PID yok). Uygulamayi acin." }

$restartCount = 0
$endTime = (Get-Date).AddMinutes($Minutes)
$sampleNum = 0

# --- ana izleme dongusu ---
while ((Get-Date) -lt $endTime) {
  Start-Sleep -Seconds $IntervalSec
  $sampleNum++
  $now = Get-Date -Format "HH:mm:ss"
  $curPid = Get-Pid

  # PID degisimi = process death + restart
  if ($curPid -and $lastPid -and ($curPid -ne $lastPid)) {
    $restartCount++
    Write-Event ">>> RESTART #$restartCount TESPIT EDILDI! Eski PID=$lastPid -> Yeni PID=$curPid <<<"
    # Restart aninda son logcat satirlarini isaretle (sebep ipucu)
    Write-Event "    (logcat-full.txt'de bu zamana yakin FATAL/ANR/lowmemory satirlarina bak)"
    $lastPid = $curPid
  }
  elseif ($curPid -and -not $lastPid) {
    Write-Event "Uygulama yeniden ayakta. PID=$curPid"
    $lastPid = $curPid
  }
  elseif (-not $curPid) {
    Write-Event "Uygulama su an OLU (PID yok) - dirilis bekleniyor..."
  }

  # Bellek ornekleme
  if ($curPid) {
    $mem = & $adb shell dumpsys meminfo $Package 2>$null
    $totalPss = ($mem | Select-String -Pattern "TOTAL PSS:\s+(\d+)" | Select-Object -First 1)
    $totalLine = ($mem | Select-String -Pattern "^\s*TOTAL\s+(\d+)" | Select-Object -First 1)
    $javaHeap = ($mem | Select-String -Pattern "Java Heap:\s+(\d+)" | Select-Object -First 1)
    $nativeHeap = ($mem | Select-String -Pattern "Native Heap:\s+(\d+)" | Select-Object -First 1)

    $pssKb = 0
    if ($totalPss) { $pssKb = [int]$totalPss.Matches[0].Groups[1].Value }
    elseif ($totalLine) { $pssKb = [int]$totalLine.Matches[0].Groups[1].Value }
    $javaKb = if ($javaHeap) { [int]$javaHeap.Matches[0].Groups[1].Value } else { 0 }
    $natKb  = if ($nativeHeap) { [int]$nativeHeap.Matches[0].Groups[1].Value } else { 0 }

    $pssMb  = [math]::Round($pssKb/1024,1)
    $javaMb = [math]::Round($javaKb/1024,1)
    $natMb  = [math]::Round($natKb/1024,1)

    "$now,$curPid,$pssMb,$javaMb,$natMb" | Out-File -FilePath $memFile -Append -Encoding utf8
    Write-Host ("  [{0}] PID={1} PSS={2}MB (Java={3} Native={4})" -f $now,$curPid,$pssMb,$javaMb,$natMb) -ForegroundColor DarkGray
  } else {
    "$now,DEAD,0,0,0" | Out-File -FilePath $memFile -Append -Encoding utf8
  }
}

# --- bitir ---
Write-Event "=== IZLEME BITTI ==="
Stop-Job $logcatJob -ErrorAction SilentlyContinue
Remove-Job $logcatJob -Force -ErrorAction SilentlyContinue

# --- otomatik on-teshis ---
Write-Event ""
Write-Event "--- ON-TESHIS OZETI ---"
Write-Event "Toplam restart sayisi: $restartCount"

$logContent = if (Test-Path $logFile) { Get-Content $logFile -Raw } else { "" }

$signals = [ordered]@{
  "ANR (Application Not Responding)" = "ANR |am_anr|Input dispatching timed out|MainActivity.*ANR"
  "OOM / Low Memory Killer"          = "lowmemorykiller|OutOfMemory|Background concurrent.*GC.*freed|killed.*because"
  "WebView renderer death"           = "render_process_gone|RenderProcessGone|chromium.*render"
  "Native crash (SIGSEGV/SIGABRT)"   = "FATAL|SIGSEGV|SIGABRT|libc|tombstone|signal"
  "Java uncaught exception"          = "AndroidRuntime|FATAL EXCEPTION|installCrashRecovery|Process.killProcess"
}

foreach ($k in $signals.Keys) {
  $count = ([regex]::Matches($logContent, $signals[$k], "IgnoreCase")).Count
  $mark = if ($count -gt 0) { "*** $count eslesme ***" } else { "yok" }
  Write-Event ("  {0,-38}: {1}" -f $k, $mark)
}

# Bellek trendi (leak isareti)
$memRows = Import-Csv $memFile | Where-Object { $_.pid -ne "DEAD" -and [double]$_.total_pss_mb -gt 0 }
if ($memRows.Count -ge 2) {
  $first = [double]$memRows[0].total_pss_mb
  $last  = [double]$memRows[-1].total_pss_mb
  $delta = [math]::Round($last - $first,1)
  Write-Event ("  Bellek trendi: {0}MB -> {1}MB (delta {2}MB)" -f $first,$last,$delta)
  if ($delta -gt 80) { Write-Event "  >>> SUREKLI ARTAN BELLEK = MEMORY LEAK SUPHESI YUKSEK <<<" }
}

Write-Event ""
Write-Event "TAMAMLANDI. Su 3 dosyayi Claude'a geri getirin:"
Write-Event "  1. $eventsFile  (en onemli - bu ozet)"
Write-Event "  2. $memFile     (bellek zaman serisi)"
Write-Event "  3. $logFile     (ham crash loglari)"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " Teshis tamamlandi. Cikti: $outDir" -ForegroundColor Green
Write-Host " events.txt'i acin ve Claude'a geri getirin." -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
