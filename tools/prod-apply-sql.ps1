# =====================================================================
# prod-apply-sql.ps1 — Carospro (PRODUCTION) veritabanına SQL uygular.
#
# ⚠️ BU ARAÇ YAZAR. Salt-okunur kardeşi ayrıdır (read_only:true kullanır).
#
# YÖNTEM: Supabase Management API `/v1/projects/{ref}/database/query`
# (SQL Editor eşdeğeri). Token Windows Credential Manager'dan okunur,
# ASLA yazdırılmaz. `supabase db push` KULLANILAMAZ çünkü doğrudan DB
# parolası bu makinede yok.
#
# ⚠️ pwsh 7 ZORUNLU: Windows PowerShell 5.1 web yanıtını Latin-1 olarak
# çözer ve Türkçe karakterleri ÇİFT KODLAR (ölçüldü: `ç` → `Ã§`).
# Migration metinleri Türkçe tanımlayıcı/mesaj içerir.
#
# GÜVENLİK KAPILARI:
#   · -Confirm parametresi tam olarak 'PRODUCTION-YAZ' olmalıdır.
#   · Dosya yolu verilmezse hiçbir şey yapmaz.
#   · Hata durumunda çıkış kodu 1'dir (çağıran zinciri durdurur).
# =====================================================================
param(
  [Parameter(Mandatory=$true)][string]$SqlFile,
  [Parameter(Mandatory=$true)][string]$Confirm,
  [string]$LedgerVersion = '',
  [string]$LedgerName = ''
)
$ErrorActionPreference = 'Stop'

if ($Confirm -ne 'PRODUCTION-YAZ') { throw "RED: -Confirm 'PRODUCTION-YAZ' olmalı" }
if ($PSVersionTable.PSVersion.Major -lt 7) { throw "RED: pwsh 7+ gerekli (kodlama guvenligi)" }
if (-not (Test-Path $SqlFile)) { throw "RED: dosya yok: $SqlFile" }

[string]$sql = [System.IO.File]::ReadAllText((Resolve-Path $SqlFile), [System.Text.Encoding]::UTF8)

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

function Invoke-Sql([string]$text, [string]$label) {
  $body = @{ query = $text; read_only = $false } | ConvertTo-Json -Compress -Depth 3
  try {
    $r = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers `
         -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -ContentType 'application/json; charset=utf-8'
    Write-Output "OK: $label"
    if ($r) { ($r | ConvertTo-Json -Depth 4 -Compress) }
    return $true
  } catch {
    $m = $_.Exception.Message
    if ($_.ErrorDetails) { $m = $_.ErrorDetails.Message }
    Write-Output "HATA: $label"
    Write-Output $m
    return $false
  }
}

if (-not (Invoke-Sql $sql (Split-Path $SqlFile -Leaf))) { exit 1 }

if ($LedgerVersion -ne '') {
  $esc = $LedgerName.Replace("'", "''")
  $led = @"
INSERT INTO supabase_migrations.schema_migrations (version, name, statements)
VALUES ('$LedgerVersion', '$esc', ARRAY['-- Management API ile uygulandi (prod-apply-sql.ps1)'])
ON CONFLICT (version) DO NOTHING;
"@
  if (-not (Invoke-Sql $led "defter: $LedgerVersion")) { exit 1 }
}
exit 0
