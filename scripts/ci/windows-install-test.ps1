# Install, uninstall and reinstall test of the Windows installer. CI ONLY: it installs SIDB for the current user on a
# throwaway GitHub Actions runner. It refuses to run anywhere else, and refuses to run if SIDB data already exists.
#
# Why no "Start-Process -Wait": that also waits for every process the started program launches. The installer starts
# SIDB when it finishes, so -Wait never returned (the 15 minute timeout in run #7). Here only the installer process
# itself is waited for, with a time limit, and the results are checked by polling for what the installer should create.
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne "true") { throw "windows-install-test.ps1 only runs on GitHub Actions (it installs SIDB for the current user)." }

$root = Resolve-Path "$PSScriptRoot\..\.."
$setup = Join-Path $root "out\release\SIDB-$Version-Setup.exe"
$install = Join-Path $env:LOCALAPPDATA "SIDB"
$appExe = Join-Path $install "app-$Version\SIDB.exe"
$updateExe = Join-Path $install "Update.exe"
$data = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "SIDB"
$db = Join-Path $data "profiles\personal\sidb.db"
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SIDB"
$failed = 0

function Say([string]$text) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $text) }

function Check([string]$name, [bool]$ok, [string]$detail = "") {
  $line = if ($detail) { "$name ($detail)" } else { $name }
  if ($ok) { Write-Host "PASS  $line"; Write-Host "::notice title=Windows install test::PASS $line" }
  else { Write-Host "FAIL  $line"; Write-Host "::error title=Windows install test::FAIL $line"; $script:failed++ }
}

function Stop-Sidb {
  Get-Process SIDB -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep 2
}

function Shortcuts {
  $places = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath("Desktop"))
  @($places | ForEach-Object { Get-ChildItem $_ -Recurse -Filter "SIDB*.lnk" -ErrorAction SilentlyContinue })
}

# Polls until the condition is true; returns whether it became true within the time limit.
function Wait-Until([scriptblock]$condition, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) {
    if (& $condition) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return [bool](& $condition)
}

# Starts a program and waits for THAT process only (not the programs it starts). Returns its exit code, or -1 on timeout.
function Run-Program([string]$file, [string[]]$arguments, [int]$timeoutSeconds) {
  $p = if ($arguments) { Start-Process -FilePath $file -ArgumentList $arguments -PassThru } else { Start-Process -FilePath $file -PassThru }
  $null = $p.Handle # keeps the handle open so ExitCode can be read after the process ends
  if (-not $p.WaitForExit($timeoutSeconds * 1000)) {
    Say "timed out after $timeoutSeconds s: $file"
    & taskkill /F /T /PID $p.Id 2>&1 | Out-Null
    return -1
  }
  return $p.ExitCode
}

function Show-Diagnostics {
  Say "--- diagnostics"
  Write-Host "install folder:"; Get-ChildItem $install -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.Name)" }
  Write-Host "SIDB processes:"; Get-Process SIDB, Update, Setup -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $($_.ProcessName) $($_.Id)" }
  $log = Join-Path $data "logs\main.log"
  if (Test-Path $log) { Write-Host "logs\main.log:"; Get-Content $log -Tail 20 | ForEach-Object { Write-Host "  $_" } }
  $sq = Join-Path $install "SquirrelSetup.log"
  if (Test-Path $sq) { Write-Host "SquirrelSetup.log:"; Get-Content $sq -Tail 20 | ForEach-Object { Write-Host "  $_" } }
}

function Install([string]$label) {
  Say "${label}: running the installer"
  $code = Run-Program $setup @() 180
  Say "${label}: installer exited with $code"
  # The installer's own work is done; wait for what it creates, and for SIDB's first start to write its database.
  $ready = Wait-Until { Test-Path $appExe } 60
  $started = Wait-Until { Test-Path $db } 90
  Say "${label}: program present: $ready, database present: $started"
  Stop-Sidb
  return $code
}

# ---- isolation: this must be a clean machine. Existing SIDB data is never touched.
Say "checking that the runner has no SIDB data or install"
if ((Test-Path $data) -or (Test-Path $install)) { throw "SIDB data or an install already exists on this machine ($data / $install); refusing to run." }
Check "installer exists" (Test-Path $setup) $setup

# ---- install
$code = Install "install"
Check "installer finished" ($code -eq 0) "exit code $code"
Check "program installed for this user" (Test-Path $appExe) $appExe
Check "update helper installed" (Test-Path $updateExe)
$links = Shortcuts
Check "Start menu / desktop shortcuts created" ($links.Count -gt 0) (($links | ForEach-Object { $_.FullName.Replace($env:USERPROFILE, "~") }) -join ", ")
Check "listed in installed apps" (Test-Path $uninstallKey)
Check "first start created the profile" (Test-Path $db) $data
if ($failed -gt 0) { Show-Diagnostics }

# ---- the installed app works (its own throwaway data folder, passed with --user-data-dir by the smoke script)
Say "smoke test of the installed app"
$env:SIDB_SMOKE_EXE = $appExe
$env:SIDB_SMOKE_LABEL = "Windows installed"
node scripts/smoke-packaged.mjs
Check "installed app passes the smoke test" ($LASTEXITCODE -eq 0)
Remove-Item Env:SIDB_SMOKE_EXE, Env:SIDB_SMOKE_LABEL

# ---- remote debugging is refused on the normal profile (this runner's profile is throwaway)
Say "remote debugging guard"
$p = Start-Process -FilePath $appExe -ArgumentList "--remote-debugging-port=9555" -PassThru
Start-Sleep 10
$running = -not $p.HasExited
$open = $false
try { Invoke-WebRequest "http://127.0.0.1:9555/json/version" -TimeoutSec 3 -UseBasicParsing | Out-Null; $open = $true } catch { $open = $false }
Check "remote debugging refused without a separate data folder" ($running -and -not $open) "running: $running, port open: $open"
Stop-Sidb

# ---- uninstall keeps user data
$marker = Join-Path $data "sidb-ci-marker.txt"
"keep me" | Out-File $marker
$dbBefore = (Get-FileHash $db).Hash
Say "uninstall"
$code = Run-Program $updateExe @("--uninstall", "-s") 120
Say "uninstall: Update.exe exited with $code"
$gone = Wait-Until { -not (Test-Path $appExe) } 60
Stop-Sidb
Check "uninstaller finished" ($code -eq 0) "exit code $code"
Check "program removed" $gone
Check "shortcuts removed" ((Shortcuts).Count -eq 0)
Check "removed from installed apps" (-not (Test-Path $uninstallKey))
Check "user data kept after uninstall" ((Test-Path $marker) -and (Test-Path $db))
Check "database unchanged by uninstall" ((Test-Path $db) -and ((Get-FileHash $db).Hash -eq $dbBefore))
if ($failed -gt 0) { Show-Diagnostics }

# ---- reinstall finds the same data
$code = Install "reinstall"
Check "reinstall finished" ($code -eq 0 -and (Test-Path $appExe)) "exit code $code"
Check "data still there after reinstall" ((Test-Path $marker) -and (Test-Path $db))
Say "reinstalled app on the existing profile"
$p = Start-Process -FilePath $appExe -PassThru
Start-Sleep 10
Check "reinstalled app runs on the existing profile" (-not $p.HasExited)
Stop-Sidb

# ---- leave the runner clean
Say "final uninstall"
$null = Run-Program $updateExe @("--uninstall", "-s") 120
Remove-Item $marker -ErrorAction SilentlyContinue

if ($failed -gt 0) { Show-Diagnostics; Write-Host "$failed check(s) failed"; exit 1 }
Write-Host "All Windows install checks passed"
exit 0
