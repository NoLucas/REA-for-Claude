# Build the Claude Desktop extension (.mcpb) on Windows.
#
#   powershell -ExecutionPolicy Bypass -File desktop\build-mcpb.ps1
#   -> dist\rea-for-claude-win32-x64.mcpb
#
# Must run on Windows (rea-agents has platform-specific native deps). Requires Node 22+ and npm.
$ErrorActionPreference = "Stop"
$Root  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Stage = Join-Path $Root "desktop\.stage"
$ReaVersion = if ($env:REA_VERSION) { $env:REA_VERSION } else { "6.7.0" }

if (Test-Path $Stage) { Remove-Item -Recurse -Force $Stage }
New-Item -ItemType Directory -Force -Path (Join-Path $Stage "server") | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root "dist") | Out-Null
Copy-Item (Join-Path $Root "desktop\manifest.json") (Join-Path $Stage "manifest.json")
foreach ($f in @("launch-rea.cjs", "rea-engines-lib.cjs", "install-engines.cjs", "install-engines.sh")) { Copy-Item (Join-Path $Root "scripts\$f") (Join-Path $Stage "server\$f") }
Copy-Item (Join-Path $Root "LICENSE") (Join-Path $Stage "LICENSE")
if (Test-Path (Join-Path $Root "desktop\icon.png")) { Copy-Item (Join-Path $Root "desktop\icon.png") (Join-Path $Stage "icon.png") }

Write-Host "[build-mcpb] installing rea-agents@$ReaVersion into the bundle (Windows)"
Push-Location (Join-Path $Stage "server")
npm init -y | Out-Null
npm install --omit=dev --no-audit --no-fund "rea-agents@$ReaVersion" | Out-Null
Pop-Location
if ($env:KEEP_FRIDA -ne "1") { Remove-Item -Recurse -Force (Join-Path $Stage "server\node_modules\frida") -ErrorAction SilentlyContinue }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) { "ARM64" { "arm64" } "AMD64" { "x64" } default { "x64" } }
$Out = Join-Path $Root "dist\rea-for-claude-win32-$arch.mcpb"

Write-Host "[build-mcpb] validating manifest"
npx -y @anthropic-ai/mcpb validate (Join-Path $Stage "manifest.json")
Write-Host "[build-mcpb] packing -> $Out"
npx -y @anthropic-ai/mcpb pack $Stage $Out
npx -y @anthropic-ai/mcpb info $Out
Remove-Item -Recurse -Force $Stage
Write-Host "[build-mcpb] done. Install: Claude Desktop -> Settings -> Extensions -> Advanced -> Install Extension... -> $Out"
