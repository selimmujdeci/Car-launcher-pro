# Migration 028 (vehicle_geofences)'i Supabase Management API query endpoint'i ile
# uygular (SQL Editor eşdeğeri). Token Windows Credential Manager'dan okunur, yazdırılmaz.
# 021/022 apply scriptiyle AYNI yöntem.
$ErrorActionPreference = 'Stop'

$sig = @'
[DllImport("Advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
public static extern bool CredRead(string target, int type, int reservedFlag, out IntPtr credentialPtr);
[DllImport("Advapi32.dll", EntryPoint="CredFree", SetLastError=true)]
public static extern bool CredFree(IntPtr cred);
'@
Add-Type -MemberDefinition $sig -Namespace Win32 -Name CredMan

$credPtr = [IntPtr]::Zero
if (-not [Win32.CredMan]::CredRead("Supabase CLI:supabase", 1, 0, [ref]$credPtr)) {
    throw "Credential Manager'dan token okunamadi (CredRead basarisiz)"
}
try {
    $blobSize = [System.Runtime.InteropServices.Marshal]::ReadInt32($credPtr, 32)
    $blobPtr  = [System.Runtime.InteropServices.Marshal]::ReadIntPtr($credPtr, 40)
    $bytes = New-Object byte[] $blobSize
    [System.Runtime.InteropServices.Marshal]::Copy($blobPtr, $bytes, 0, $blobSize)
    $token = [System.Text.Encoding]::UTF8.GetString($bytes).Trim()
} finally {
    [void][Win32.CredMan]::CredFree($credPtr)
}
if (-not $token.StartsWith('sbp_')) { throw "Token formati beklenmedik (sbp_ ile baslamiyor), uzunluk=$($token.Length)" }

$ref = 'vdpcdhrdmsacftrietzq'
$uri = "https://api.supabase.com/v1/projects/$ref/database/query"
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# Preflight: token + proje erisimi
try {
    $proj = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref" -Headers $headers
    Write-Output "PREFLIGHT OK: $($proj.name) ($($proj.id)) status=$($proj.status)"
} catch {
    $code = ''
    if ($_.Exception.Response) { $code = [int]$_.Exception.Response.StatusCode }
    Write-Output "PREFLIGHT HATA: HTTP $code - $($_.Exception.Message)"
    exit 1
}

$files = @(
    'supabase\migrations\20260706000028_vehicle_geofences.sql'
)

foreach ($f in $files) {
    [string]$sql = Get-Content -Raw -Encoding UTF8 (Join-Path $PSScriptRoot "..\$f")
    # PowerShell 7'de System.Web.Extensions yüklenmiyor → ConvertTo-Json (SQL küçük).
    $body = @{ query = $sql } | ConvertTo-Json -Compress -Depth 3
    Write-Output "=== Uygulaniyor: $f ==="
    try {
        $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
        Write-Output "SONUC: BASARILI"
        if ($resp) { $resp | ConvertTo-Json -Depth 5 -Compress | Write-Output }
    } catch {
        Write-Output "SONUC: HATA"
        Write-Output "Mesaj: $($_.Exception.Message)"
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            Write-Output ("Govde (ErrorDetails): " + $_.ErrorDetails.Message)
        }
        if ($_.Exception.Response) {
            Write-Output "HTTP: $([int]$_.Exception.Response.StatusCode)"
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                $stream.Position = 0
                $reader = New-Object IO.StreamReader($stream)
                Write-Output ("Govde: " + $reader.ReadToEnd())
            } catch { Write-Output "Govde okunamadi: $($_.Exception.Message)" }
        }
        exit 1
    }
}
Write-Output "=== Migration 028 uygulandi ==="
