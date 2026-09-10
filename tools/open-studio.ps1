$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioUrl = 'http://127.0.0.1:4003/'
$running = $false
try {
    $session = Invoke-RestMethod -Uri ($studioUrl + 'api/session') -TimeoutSec 2
    $running = [bool]$session.token
} catch { }
if (-not $running) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $logDirectory = Join-Path $projectRoot '.studio'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + (Join-Path $projectRoot 'tools/studio.cjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory 'server.log') -RedirectStandardError (Join-Path $logDirectory 'server-error.log')
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try {
            $session = Invoke-RestMethod -Uri ($studioUrl + 'api/session') -TimeoutSec 1
            if ($session.token) { $running = $true; break }
        } catch { }
    }
}
if ($running) { Start-Process $studioUrl }
else { throw '写作台未能启动，请查看项目 .studio/server-error.log。' }
