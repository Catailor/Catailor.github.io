# Adds a "月下手记写作台" icon to the desktop and Start menu. Run once per computer (npm run studio:shortcut).
param([switch]$Remove)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$name = '月下手记写作台'
$places = @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Programs'))
$links = $places | ForEach-Object { Join-Path $_ "$name.lnk" }
if ($Remove) {
    $links | Where-Object { Test-Path $_ } | ForEach-Object { Remove-Item $_ }
    Write-Host '已删除桌面和开始菜单里的写作台图标。'
    exit 0
}
$iconDirectory = Join-Path $env:LOCALAPPDATA 'MoonlitStudio'
New-Item -ItemType Directory -Path $iconDirectory -Force | Out-Null
$icon = Join-Path $iconDirectory 'studio.ico'
[IO.File]::WriteAllBytes($icon, [Convert]::FromBase64String((Get-Content (Join-Path $PSScriptRoot 'studio/app-icon.ico.b64') -Raw)))
$shell = (Get-Process -Id $PID).Path
$arguments = "-NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'open-studio.ps1')`""
# conhost --headless runs the launcher without any console window, even when Windows Terminal is the default terminal.
$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$wsh = New-Object -ComObject WScript.Shell
foreach ($link in $links) {
    $shortcut = $wsh.CreateShortcut($link)
    if (Test-Path $conhost) { $shortcut.TargetPath = $conhost; $shortcut.Arguments = "--headless `"$shell`" $arguments" }
    else { $shortcut.TargetPath = $shell; $shortcut.Arguments = $arguments }
    $shortcut.WorkingDirectory = $projectRoot
    $shortcut.IconLocation = "$icon,0"
    $shortcut.WindowStyle = 7
    $shortcut.Description = '打开月下手记的本机写作台'
    $shortcut.Save()
}
Write-Host "已添加「$name」图标：桌面和开始菜单各一个。"
Write-Host '想固定到任务栏：在开始菜单里右键它 →「固定到任务栏」。'
Write-Host '项目文件夹搬家后，重新运行一次 npm run studio:shortcut 即可。'
