# Tek seferlik salt-okunur SQL sorgusu — Supabase Management API query endpoint'i.
# Kullanım: .\sa-query.ps1 "SELECT ..."
# Token Windows Credential Manager'dan okunur, yazdırılmaz.
param([Parameter(Mandatory=$true)][string]$Query)
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
    throw "Credential Manager'dan token okunamadi"
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

$uri = "https://api.supabase.com/v1/projects/vdpcdhrdmsacftrietzq/database/query"
$headers = @{ Authorization = "Bearer $token"; 'Content-Type' = 'application/json' }
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

Add-Type -AssemblyName System.Web.Extensions
$ser = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$ser.MaxJsonLength = 33554432
$body = $ser.Serialize(@{ query = $Query })

try {
    $resp = Invoke-RestMethod -Method Post -Uri $uri -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($body))
    $resp | ConvertTo-Json -Depth 8
} catch {
    Write-Output "HATA: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        try {
            $stream = $_.Exception.Response.GetResponseStream(); $stream.Position = 0
            (New-Object IO.StreamReader($stream)).ReadToEnd() | Write-Output
        } catch {}
    }
    exit 1
}
