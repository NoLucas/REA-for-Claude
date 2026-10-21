# install-engines.ps1 — Windows counterpart of install-engines.sh.
#
#   powershell -ExecutionPolicy Bypass -File scripts\install-engines.ps1 [-Engines ghidra,jadx] [-Dir <path>] [-SetEnv] [-WriteConfig]
#
# Installs into %USERPROFILE%\.rea-engines (or -Dir):
#   - Ghidra 12.1.4 (SHA-256 verified)      -> <dir>\ghidra_12.1.4_PUBLIC
#   - jadx-headless-mcp 0.7.1                -> <dir>\jadx-headless-mcp-0.7.1-all.jar
# Checks for a 64-bit JDK 21+ (java + javac on PATH). Does not install Java: use
#   winget install EclipseAdoptium.Temurin.21.JDK   (or any JDK 21+)
#
# -SetEnv       also writes GHIDRA_INSTALL_DIR / REA_JADX_MCP_JAR as *user* environment
#               variables (new terminals and Claude Desktop pick them up after restart)
# -WriteConfig  also writes/updates %USERPROFILE%\.rea-plugin.json with the paths
#
# Idempotent: existing pieces are skipped. The launcher auto-discovers this directory, so
# neither switch is required unless you use REA's own `rea setup` registration.
[CmdletBinding()]
param(
  [string[]]$Engines = @('ghidra', 'jadx'),
  [string]$Dir = (Join-Path $env:USERPROFILE '.rea-engines'),
  [switch]$SetEnv,
  [switch]$WriteConfig
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$GhidraVersion = '12.1.4'
$GhidraZip     = 'ghidra_12.1.4_PUBLIC_20260921.zip'
$GhidraUrl     = "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/$GhidraZip"
$GhidraSha256  = 'ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db'
$GhidraDir     = Join-Path $Dir "ghidra_${GhidraVersion}_PUBLIC"
$JadxJar       = 'jadx-headless-mcp-0.7.1-all.jar'
$JadxUrl       = "https://github.com/1013503897/jadx-headless-mcp/releases/download/v0.7.1/$JadxJar"
$JadxPath      = Join-Path $Dir $JadxJar

function Log($m) { Write-Host "[install-engines $(Get-Date -Format HH:mm:ss)] $m" }
function Want($name) { return ($Engines -contains 'all') -or ($Engines -contains $name) }

New-Item -ItemType Directory -Force -Path $Dir | Out-Null

# ---- Java --------------------------------------------------------------------
$javaOk = $false
try {
  $v = (& java -version 2>&1 | Select-Object -First 1) -join ''
  if ($v -match 'version "(\d+)') { $major = [int]$Matches[1]; if ($major -ge 21) { $javaOk = $true } }
  Log "java: $v"
} catch { }
if (-not $javaOk) {
  Log 'JDK 21+ (64-bit, with javac) not found on PATH. Install one, e.g.:'
  Log '    winget install EclipseAdoptium.Temurin.21.JDK'
  Log 'then re-run this script. Ghidra will not work until Java is present.'
}
if (-not (Get-Command javac -ErrorAction SilentlyContinue)) { Log 'warning: javac not on PATH; REA doctor requires a full JDK, not a JRE' }

# ---- Ghidra ------------------------------------------------------------------
if (-not (Want 'ghidra')) { Log 'ghidra not selected; skipping' }
elseif (Test-Path (Join-Path $GhidraDir 'support\analyzeHeadless.bat')) { Log "ghidra $GhidraVersion already installed at $GhidraDir" }
else {
  $tmp = Join-Path $Dir ".$GhidraZip.part"
  Log "downloading Ghidra $GhidraVersion (~570 MB) ..."
  Invoke-WebRequest -Uri $GhidraUrl -OutFile $tmp -UseBasicParsing
  $hash = (Get-FileHash -Algorithm SHA256 -Path $tmp).Hash.ToLowerInvariant()
  if ($hash -ne $GhidraSha256) { Remove-Item $tmp -Force; throw "SHA-256 mismatch for $GhidraZip (got $hash)" }
  Log 'sha256 verified; extracting'
  $stage = "$GhidraDir.tmp"
  if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
  Expand-Archive -Path $tmp -DestinationPath $stage -Force
  Move-Item (Join-Path $stage "ghidra_${GhidraVersion}_PUBLIC") $GhidraDir
  Remove-Item -Recurse -Force $stage; Remove-Item $tmp -Force
  Log "ghidra installed at $GhidraDir"
}

# ---- jadx-headless-mcp ----------------------------------------------------------
if (-not (Want 'jadx')) { Log 'jadx not selected; skipping' }
elseif ((Test-Path $JadxPath) -and ((Get-Item $JadxPath).Length -gt 0)) { Log 'jadx-headless-mcp already present' }
else {
  Log 'downloading jadx-headless-mcp 0.7.1 (~40 MB) ...'
  Invoke-WebRequest -Uri $JadxUrl -OutFile "$JadxPath.part" -UseBasicParsing
  Move-Item "$JadxPath.part" $JadxPath -Force
  Log 'jadx-headless-mcp installed'
}

# ---- optional: env vars / config ------------------------------------------------
if ($SetEnv) {
  if (Want 'ghidra') { [Environment]::SetEnvironmentVariable('GHIDRA_INSTALL_DIR', $GhidraDir, 'User') }
  if (Want 'jadx')   { [Environment]::SetEnvironmentVariable('REA_JADX_MCP_JAR', $JadxPath, 'User') }
  Log 'user environment variables written (restart terminals / Claude Desktop to pick them up)'
}
if ($WriteConfig) {
  $cfgPath = Join-Path $env:USERPROFILE '.rea-plugin.json'
  $cfg = @{}
  if (Test-Path $cfgPath) {
    # Works on Windows PowerShell 5.1 too (no -AsHashtable)
    try { $obj = Get-Content $cfgPath -Raw | ConvertFrom-Json; foreach ($pr in $obj.PSObject.Properties) { $cfg[$pr.Name] = $pr.Value } } catch { $cfg = @{} }
  }
  if (Want 'ghidra') { $cfg['ghidra_install_dir'] = $GhidraDir }
  if (Want 'jadx')   { $cfg['jadx_mcp_jar'] = $JadxPath }
  $cfg['engines_dir'] = $Dir
  ($cfg | ConvertTo-Json -Depth 5) | Set-Content -Path $cfgPath -Encoding UTF8
  Log "config written: $cfgPath"
}

Set-Content -Path (Join-Path $Dir 'install.done') -Value ((Get-Date).ToUniversalTime().ToString('o'))
Log "done. GHIDRA_INSTALL_DIR=$GhidraDir  REA_JADX_MCP_JAR=$JadxPath"
Log 'The plugin launcher auto-discovers this directory; restart Claude Code / Claude Desktop once.'
