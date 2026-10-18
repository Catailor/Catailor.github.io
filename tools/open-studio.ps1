# Opens the local writing studio: starts the service if needed and shows it in its own app window.
param([switch]$NoBrowser, [switch]$Tab)
$ErrorActionPreference = 'Stop'
$version = 'studio-v3'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))

function Show-Problem([string]$message) {
    # Launched from a shortcut the console is hidden, so report problems in a dialog.
    try {
        Add-Type -AssemblyName PresentationFramework
        [void][System.Windows.MessageBox]::Show($message, '月下手记写作台', 'OK', 'Warning')
    } catch { Write-Error $message }
}

function Get-Session([string]$url) {
    try { return Invoke-RestMethod -Uri ($url + 'api/session') -TimeoutSec 2 } catch { return $null }
}

# A studio service left over from an older version keeps old code in memory; stop it so the new one can start.
function Stop-OldStudio([int]$port) {
    foreach ($connection in @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)) {
        $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
        if ($process -and $process.Name -match '^node(\.exe)?$' -and $process.CommandLine -match 'studio\.cjs') {
            Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            Start-Sleep -Milliseconds 400
        }
    }
}

# After `git pull` changed dependencies, install them once (in a visible window, it can take a minute).
function Update-Dependencies {
    $lock = Join-Path $projectRoot 'package-lock.json'
    $installed = Join-Path $projectRoot 'node_modules/.package-lock.json'
    if ((Test-Path $installed) -and (Get-Item $installed).LastWriteTimeUtc -ge (Get-Item $lock).LastWriteTimeUtc) { return }
    $npm = (Get-Command npm.cmd, npm -ErrorAction SilentlyContinue | Select-Object -First 1).Source
    if (-not $npm) { throw '没有找到 npm，请先安装 Node.js。' }
    $shell = (Get-Process -Id $PID).Path
    $script = "Write-Host '写作台更新了，正在安装需要的组件（npm ci），请稍候……'; & '$($npm -replace "'", "''")' ci; if (`$LASTEXITCODE) { Read-Host '安装失败，请把上面的信息发给维护者。按回车关闭'; exit 1 }"
    $job = Start-Process -FilePath $shell -ArgumentList @('-NoLogo', '-NoProfile', '-Command', $script) -WorkingDirectory $projectRoot -Wait -PassThru
    if ($job.ExitCode -ne 0) { throw '组件安装失败，写作台没有启动。' }
}

function Find-AppBrowser {
    $candidates = @()
    foreach ($name in 'msedge.exe', 'chrome.exe') {
        foreach ($hive in 'HKCU:', 'HKLM:') {
            $key = "$hive\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\$name"
            $value = (Get-ItemProperty -Path $key -ErrorAction SilentlyContinue).'(default)'
            if ($value) { $candidates += $value.Trim('"') }
        }
    }
    $candidates += @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    return $candidates | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
}

try {
    $studioUrl = $null; $studioPort = $null; $running = $false; $freePort = $null
    foreach ($candidatePort in @(4003, 4009, 4015)) {
        $candidateUrl = "http://127.0.0.1:$candidatePort/"
        $session = Get-Session $candidateUrl
        if ($session -and $session.version -eq $version) { $studioUrl = $candidateUrl; $studioPort = $candidatePort; $running = $true; break }
        Stop-OldStudio $candidatePort
        if (-not $freePort -and -not (Get-NetTCPConnection -LocalPort $candidatePort -State Listen -ErrorAction SilentlyContinue)) { $freePort = $candidatePort }
    }
    if (-not $studioUrl -and $freePort) { $studioPort = $freePort; $studioUrl = "http://127.0.0.1:$studioPort/" }
    if (-not $studioUrl) { throw '本机写作台端口（4003、4009、4015）都被其他程序占用，请关闭后再打开。' }
    if (-not $running) {
        Update-Dependencies
        $nodeExecutable = (Get-Command node -ErrorAction SilentlyContinue).Source
        if (-not $nodeExecutable) { throw '没有找到 Node.js，请先安装 Node.js。' }
        $logDirectory = Join-Path $projectRoot '.studio'
        New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
        $previousPort = $env:MOONLIT_STUDIO_PORT
        $previousPrivatePort = $env:MOONLIT_PRIVATE_PORT
        try {
            $env:MOONLIT_STUDIO_PORT = "$studioPort"
            $env:MOONLIT_PRIVATE_PORT = "$($studioPort + 3)"
            Start-Process -FilePath $nodeExecutable -ArgumentList ('"' + (Join-Path $projectRoot 'tools/studio.cjs') + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logDirectory "server-$studioPort.log") -RedirectStandardError (Join-Path $logDirectory "server-$studioPort-error.log")
        } finally { $env:MOONLIT_STUDIO_PORT = $previousPort; $env:MOONLIT_PRIVATE_PORT = $previousPrivatePort }
        # The first start after an update also builds the editor, which can take several seconds.
        for ($attempt = 0; $attempt -lt 100; $attempt++) {
            Start-Sleep -Milliseconds 300
            $session = Get-Session $studioUrl
            if ($session -and $session.version -eq $version) { $running = $true; break }
        }
    }
    if (-not $running) { throw "写作台没能启动。详细原因在项目的 .studio\server-$studioPort-error.log 里。" }
    if ($NoBrowser) { Write-Output $studioUrl; exit 0 }
    $browser = if ($Tab) { $null } else { Find-AppBrowser }
    if ($browser) { Start-Process -FilePath $browser -ArgumentList @("--app=$studioUrl", '--window-size=1360,900') }
    else { Start-Process $studioUrl }
} catch {
    Show-Problem $_.Exception.Message
    exit 1
}
