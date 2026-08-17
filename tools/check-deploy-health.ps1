# =====================================================================
# check-deploy-health.ps1 — Vercel deploy sagligi kontrolu (SALT-OKUNUR).
#
# NEDEN VAR (kutuk #607): BASARISIZ DEPLOY KENDINI DUYURMAZ. Vercel bir
# derleme dustugunde alan adini DEGISTIRMEZ — son BASARILI derlemeyi
# sunmaya devam eder. Site acilir, 200 doner, her sey normal gorunur.
# Bu repoda bu tuzaga iki kez dusuldu:
#   · .vercelignore kirigi        → car-launcher-pro 24 GUN eski derlemede
#   · website/tsconfig.json kirigi → carospro          9 GUN eski derlemede
# Ikisi de ancak biri elle deploy etmeye calisinca fark edildi.
#
# ⚠️ ALAN ADINI SORGULAMAK YETMEZ: `vercel inspect carospro.com` o an
# SUNULAN (yani son BASARILI) derlemeyi inceler ve ● Ready der — tam da
# kacirmak istedigimiz durumu KACIRIR. Bu yuzden burada EN SON deployment
# kaydina bakilir, alan adina degil.
#
# Kullanim:
#   pwsh -File tools/check-deploy-health.ps1
#   pwsh -File tools/check-deploy-health.ps1 -Projects carospro
#
# Cikis kodu: en son deployment'i ● Ready olmayan proje varsa 1, yoksa 0.
# (CI'da veya deploy sonrasi kapi olarak kullanilabilir.)
#
# Gereksinim: `vercel` CLI kurulu ve giris yapilmis olmali.
# =====================================================================
param(
  [string[]]$Projects = @('carospro','car-launcher-pro')
)
$ErrorActionPreference = 'Stop'

# Kultur-bagimsiz eslesme ZORUNLU: bu makine tr-TR ve .NET'te buyuk/kucuk
# harf duyarsiz eslesme varsayilan olarak GECERLI KULTURU kullanir; Turkcede
# 'I'nin kucugu 'i' degil 'i'siz 'ı'dir. Ayni tuzak prod-read-sql.ps1'in
# salt-okunur kapisini fail-open birakmisti (kutuk #608).
$reOpts = [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, CultureInvariant'

$failed = @()

foreach ($p in $Projects) {
  Write-Host ""
  Write-Host "=== $p ===" -ForegroundColor Cyan

  # ⚠️ `2>&1` ZORUNLU: `vercel ls` tabloyu STDOUT'a DEĞİL STDERR'e basar.
  # (Olculdu: `vercel ls carospro 2>/dev/null | grep` HİÇBİR SATIR dondurmez ve
  #  "deployment yok" gibi gorunur — bu tuzaga bir kez dusuldu.)
  $raw = ''
  try {
    $raw = (& npx vercel ls $p 2>&1 | Out-String)
  } catch {
    Write-Host "  OKUNAMADI: vercel CLI calistirilamadi" -ForegroundColor Yellow
    $failed += "$p (CLI hatasi)"
    continue
  }

  # Deployment TABLO satirlari.
  # ⚠️ URL'e bakmak YETMEZ: `vercel ls` tablonun arasina CIPLAK URL satirlari da
  # basiyor (olculdu — ilk eslesme o satir oluyordu ve durum "BILINMIYOR" cikiyordu).
  # Gercek tablo satirinin ayirt edici isareti DURUM ISARETI (●) ile birlikte
  # bir URL tasimasidir.
  # En ustteki = en yeni (vercel ls yeniden eskiye siralar).
  $rows = $raw -split "`n" | Where-Object {
    [regex]::IsMatch($_, 'https://\S+\.vercel\.app', $reOpts) -and $_.Contains([char]0x25CF)
  }
  if ($rows.Count -eq 0) {
    Write-Host "  DEPLOYMENT YOK / cikti ayristirilamadi" -ForegroundColor Yellow
    $failed += "$p (deployment bulunamadi)"
    continue
  }

  # En son deployment (ortamdan bagimsiz) — kirilan derleme burada gorunur.
  # ASIL SINYAL BUDUR: #607'de production alan adi saglikliydi ama en son
  # deployment ● Error'du; 9 gundur her deploy dusuyordu.
  $latest  = $rows[0]
  $mStatus = [regex]::Match($latest, '●\s*(\w+)', $reOpts)
  $mEnv    = [regex]::Match($latest, '\b(Production|Preview)\b', $reOpts)
  $mUrl    = [regex]::Match($latest, 'https://\S+\.vercel\.app', $reOpts)
  $mAge    = [regex]::Match($latest, '^\s*(\S+)', $reOpts)

  $status = if ($mStatus.Success) { $mStatus.Groups[1].Value } else { 'BILINMIYOR' }
  $env    = if ($mEnv.Success)    { $mEnv.Groups[1].Value }    else { 'BILINMIYOR' }
  $age    = if ($mAge.Success)    { $mAge.Groups[1].Value }    else { '?' }

  # En son PRODUCTION deployment AYRI sorgulanir. Varsayilan listede yalnizca
  # son N deployment doner; hepsi Preview ise production satiri hic gorunmez ve
  # "production YOK" gibi bir YANLIS ALARM uretir (olculdu: car-launcher-pro).
  $prodStatus = 'BELIRSIZ'
  $prodAge    = '?'
  try {
    $prodRaw  = (& npx vercel ls $p --environment production 2>&1 | Out-String)
    $prodRows = $prodRaw -split "`n" | Where-Object {
      [regex]::IsMatch($_, 'https://\S+\.vercel\.app', $reOpts) -and $_.Contains([char]0x25CF)
    }
    if ($prodRows.Count -gt 0) {
      $m  = [regex]::Match($prodRows[0], '●\s*(\w+)', $reOpts)
      $ma = [regex]::Match($prodRows[0], '^\s*(\S+)', $reOpts)
      if ($m.Success)  { $prodStatus = $m.Groups[1].Value }
      if ($ma.Success) { $prodAge    = $ma.Groups[1].Value }
    } else {
      $prodStatus = 'HIC YOK'
    }
  } catch {
    $prodStatus = 'OKUNAMADI'
  }

  $okLatest = [regex]::IsMatch($status,     '^Ready$', $reOpts)
  $okProd   = [regex]::IsMatch($prodStatus, '^Ready$', $reOpts)

  Write-Host ("  en son deployment : {0,-10} [{1}]  {2} once" -f $status, $env, $age) `
    -ForegroundColor $(if ($okLatest) { 'Green' } else { 'Red' })
  Write-Host ("  en son production : {0,-10} {1} once" -f $prodStatus, $prodAge) `
    -ForegroundColor $(if ($okProd) { 'Green' } else { 'Red' })
  if ($mUrl.Success) { Write-Host ("  url               : {0}" -f $mUrl.Value) -ForegroundColor DarkGray }

  # Fail-closed: "okunamadi/belirsiz" saglikli SAYILMAZ — bu betigin varlik
  # sebebi sessizce saglikli gorunen kirik durumlardir.
  if (-not $okLatest) { $failed += "$p (en son deployment: $status)" }
  elseif (-not $okProd) { $failed += "$p (en son production: $prodStatus)" }
}

Write-Host ""
if ($failed.Count -gt 0) {
  Write-Host "SONUC: SAGLIKSIZ -> $($failed -join ' | ')" -ForegroundColor Red
  Write-Host "Not: alan adi hala eski BASARILI derlemeyi sunuyor olabilir; site acilmasi kanit DEGILDIR." -ForegroundColor Yellow
  exit 1
}
Write-Host "SONUC: tum projelerin en son deploy'u ● Ready" -ForegroundColor Green
exit 0
