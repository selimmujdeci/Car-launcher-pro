# prod-read.ps1 — Carospro (prod) SALT-OKUNUR sorgu aracı.
# Token Windows Credential Manager'dan okunur, ASLA yazdırılmaz.
# Güvenlik kapısı: SQL yalnız SELECT/WITH ile başlayabilir; yazma anahtar
# kelimeleri (INSERT/UPDATE/DELETE/CREATE/ALTER/DROP/GRANT/REVOKE/TRUNCATE)
# görülürse çalıştırılmaz.
param(
  [Parameter(Mandatory=$true)][string]$SqlFile,
  [string]$OutFile = ''
)
$ErrorActionPreference = 'Stop'

[string]$sql = Get-Content -Raw -Encoding UTF8 $SqlFile

# --- salt-okunur kapısı (fail-closed) ---
#
# ⚠️ KÜLTÜRE DUYARLI EŞLEŞME YASAK — TÜRKÇE 'I' TUZAĞI (2026-08-17'de ÖLÇÜLDÜ).
#
# Bu makinenin kültürü tr-TR. .NET'te büyük/küçük harf duyarsız regex VARSAYILAN
# OLARAK GEÇERLİ KÜLTÜRÜ kullanır ve Türkçede 'I'nın küçüğü 'i' DEĞİL 'ı'dır.
# Sonuç, PowerShell `-match`/`-notmatch` ile birebir ölçüldü:
#
#   'INSERT INTO t' -match '(?i)insert\s'   →  False   ← KAPI AÇIK KALIYORDU
#   'WITH x'        -match '(?i)^with\b'    →  False   ← CTE sorguları REDDEDİLİYORDU
#
# Yani kapı hem FAIL-OPEN'dı (içinde 'i' geçen tek yazma kelimesi olan INSERT
# tespit edilemiyordu) hem de meşru `WITH ...` sorgularını reddediyordu. İçinde
# 'i' geçmeyen kelimeler (UPDATE/DELETE/DROP/GRANT/TRUNCATE) yakalanıyordu —
# bu yüzden kusur uzun süre görünmedi: kapı ÇALIŞIYOR gibi duruyordu.
#
# ÇÖZÜM: eşleşmeler `[regex]::IsMatch` ile ve AÇIKÇA `CultureInvariant`
# seçeneğiyle yapılır. PowerShell'in `-match` operatörü bu seçeneği alamaz,
# bu yüzden bilerek KULLANILMAZ.
$reOpts = [System.Text.RegularExpressions.RegexOptions]'IgnoreCase, CultureInvariant, Singleline'

$stripped = ($sql -replace '(?m)^\s*--.*$','').Trim()
if (-not [regex]::IsMatch($stripped, '^\s*(select|with)\b', $reOpts)) {
  throw "RED: sorgu SELECT/WITH ile baslamiyor (salt-okunur kapisi)"
}
$forbidden = 'insert\s|update\s|delete\s|create\s|alter\s|drop\s|grant\s|revoke\s|truncate\s|comment\s+on|refresh\s+materialized|call\s|do\s+\$\$'
if ([regex]::IsMatch($stripped, "\b($forbidden)", $reOpts)) {
  throw "RED: sorguda yazma anahtar kelimesi var (salt-okunur kapisi)"
}

$sig = @'
[DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("Advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
public static extern bool CredFree(IntPtr cred);
'@
Add-Type -MemberDefinition $sig -Namespace Win32 -Name CredMan

$credPtr = [IntPtr]::Zero
if (-not [Win32.CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$credPtr)) {
  throw "Credential Manager'dan token okunamadi"
}
try {
  $blobSize = [System.Runtime.InteropServices.Marshal]::ReadInt32($credPtr, 32)
  $blobPtr  = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($credPtr, 40)
  $bytes = New-Object byte[] $blobSize
  [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $blobSize)
  $token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally { [void][Win32.CredMan]::CredFree($credPtr) }
if (-not $token.StartsWith('sbp_')) { throw "Token formati beklenmedik" }

$ref = 'vdpcdhrdmsacftrietzq'
$uri = "https://api.supabase.com/v1/projects/$ref/database/query"
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$body = @{ query = $sql; read_only = $true } | ConvertTo-Json -Compress -Depth 3
try {
  $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
} catch {
  $msg = $_.Exception.Message
  if ($_.ErrorDetails) { $msg = $_.ErrorDetails.Message }
  Write-Output "HATA: $msg"
  exit 1
}
$json = $resp | ConvertTo-Json -Depth 8
# UTF-8'i BOM'suz ve ÇİFT KODLAMASIZ yaz. (Windows PowerShell 5.1'in
# Out-File -Encoding UTF8'i BOM ekler; ayrıca 5.1 web yanıtını Latin-1 olarak
# çözdüğü için Türkçe karakterler ÇİFT KODLANIR — bu yüzden pwsh 7 ŞARTTIR.)
if ($OutFile -ne '') {
  [System.IO.File]::WriteAllText($OutFile, $json, (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "YAZILDI: $OutFile ($($json.Length) bayt)"
} else { Write-Output $json }
