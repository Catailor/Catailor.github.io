param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$studioUrl = $null
$studioPort = $null
$running = $false
$freePort = $null
foreach ($candidatePort in @(4003, 4009, 4015)) {
    $candidateUrl = "http://127.0.0.1:$candidatePort/"
    try {
        $session = Invoke-RestMethod -Uri ($candidateUrl + 'api/session') -TimeoutSec 2
        if ($session.version -eq 'history-v1') { $studioUrl = $candidateUrl; $studioPort = $candidatePort; $running = $true; break }
    } catch {
        if (-not (Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue)) {
            if (-not $freePort) { $freePort = $candidatePort }
        }
    }
}
if (-not $studioUrl -and $freePort) { $studioPort = $freePort; $studioUrl = "http://127.0.0.1:$studioPort/" }
if (-not $studioUrl) { throw '本机写作台端口均被占用，请关闭旧写作服务后再打开。' }
if (-not $running) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
    $logDirectory = Join-Path $projectRoot '.studio'
    New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
    $previousPort = $env:MOONLIT_STUDIO_PORT
    $previousPrivatePort = $env:MOONLIT_PRIVATE_PORT
    try {
        $env:MOONLIT_STUDIO_PORT = "$studioPort"
        $env:MOONLIT_PRIVATE_PORT = "$($studioPort + 3)"
        Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + (Join-Path $projectRoot 'tools/studio.cjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory "server-$studioPort.log") -RedirectStandardError (Join-Path $logDirectory "server-$studioPort-error.log")
    } finally { $env:MOONLIT_STUDIO_PORT = $previousPort; $env:MOONLIT_PRIVATE_PORT = $previousPrivatePort }
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        Start-Sleep -Milliseconds 300
        try {
            $session = Invoke-RestMethod -Uri ($studioUrl + 'api/session') -TimeoutSec 1
            if ($session.version -eq 'history-v1') { $running = $true; break }
        } catch { }
    }
}
if ($running) { if ($NoBrowser) { Write-Output $studioUrl } else { Start-Process $studioUrl } }
else { throw "写作台未能启动，请查看项目 .studio/server-$studioPort-error.log。" }
