# browser-flow-tracker installer for Windows (PowerShell)
# Run in PowerShell:
#   irm https://apiflowtracker.com/install.ps1 | iex
$ErrorActionPreference = 'Stop'

$repo  = 'devggaurav/web-Api-scrapper'
$asset = 'browser-flow-tracker-windows-x64.exe'
$url   = "https://github.com/$repo/releases/latest/download/$asset"

$destDir = Join-Path $env:LOCALAPPDATA 'browser-flow-tracker'
New-Item -ItemType Directory -Force -Path $destDir | Out-Null
$dest = Join-Path $destDir 'browser-flow-tracker.exe'

Write-Host "Downloading $asset ..."
Invoke-WebRequest -Uri $url -OutFile $dest

# JSON needs backslashes escaped.
$escaped = $dest -replace '\\', '\\'

Write-Host ""
Write-Host "Installed to $dest"
Write-Host ""
Write-Host "Add this to your Claude Code / Cursor MCP config:"
Write-Host ""
Write-Host '  {'
Write-Host '    "mcpServers": {'
Write-Host '      "browser-flow-tracker": {'
Write-Host "        `"command`": `"$escaped`""
Write-Host '      }'
Write-Host '    }'
Write-Host '  }'
Write-Host ""
Write-Host 'Then restart your AI app and say:'
Write-Host '  "let''s record the session for this url https://example.com"'
