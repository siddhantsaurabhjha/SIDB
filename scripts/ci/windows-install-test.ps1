# Install, uninstall and reinstall test of the Windows installer. CI ONLY: it installs SIDB for the current user and
# uses that user's real SIDB profile folder, so it must only run on a throwaway machine (the GitHub Actions runner).
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne "true") { throw "windows-install-test.ps1 only runs on GitHub Actions (it installs SIDB and uses the real profile folder)." }

$root = Resolve-Path "$PSScriptRoot\..\.."
$setup = Join-Path $root "out\release\SIDB-$Version-Setup.exe"
$install = Join-Path $env:LOCALAPPDATA "SIDB"
$appExe = Join-Path $install "app-$Version\SIDB.exe"
$data = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "SIDB"
$failed = 0

function Check([string]$name, [bool]$ok, [string]$detail = "") {
  $line = if ($detail) { "$name ($detail)" } else { $name }
  if ($ok) { Write-Host "PASS  $line"; Write-Host "::notice title=Windows install test::PASS $line" }
  else { Write-Host "FAIL  $line"; Write-Host "::error title=Windows install test::FAIL $line"; $script:failed++ }
}
function Stop-Sidb { Get-Process SIDB -ErrorAction SilentlyContinue | Stop-Process -Force; Start-Sleep 2 }
function Shortcuts {
  $places = @("$env:APPDATA\Microsoft\Windows\Start Menu\Programs", [Environment]::GetFolderPath("Desktop"))
  @($places | ForEach-Object { Get-ChildItem $_ -Recurse -Filter "SIDB*.lnk" -ErrorAction SilentlyContinue })
}
function Install {
  $p = Start-Process -FilePath $setup -PassThru -Wait
  Start-Sleep 15 # the installer starts SIDB when it is done
  Stop-Sidb
  return $p.ExitCode
}

Check "installer exists" (Test-Path $setup) $setup

# ---- install
$code = Install
Check "installer finished" ($code -eq 0) "exit code $code"
Check "program installed for this user" (Test-Path $appExe) $appExe
Check "update helper installed" (Test-Path "$install\Update.exe")
$links = Shortcuts
Check "Start menu / desktop shortcuts created" ($links.Count -gt 0) (($links | ForEach-Object { $_.FullName.Replace($env:USERPROFILE, "~") }) -join ", ")
$uninstallKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SIDB"
Check "listed in installed apps" (Test-Path $uninstallKey)
Check "first start created the profile" (Test-Path "$data\profiles\personal\sidb.db") $data

# ---- the installed app works (throwaway data folder)
$env:SIDB_SMOKE_EXE = $appExe
$env:SIDB_SMOKE_LABEL = "Windows installed"
node scripts/smoke-packaged.mjs
Check "installed app passes the smoke test" ($LASTEXITCODE -eq 0)
Remove-Item Env:SIDB_SMOKE_EXE, Env:SIDB_SMOKE_LABEL

# ---- remote debugging is refused on the normal profile (safe here: this runner's profile is throwaway)
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
$dbBefore = (Get-FileHash "$data\profiles\personal\sidb.db").Hash
Start-Process -FilePath "$install\Update.exe" -ArgumentList "--uninstall", "-s" -Wait
Start-Sleep 10
Stop-Sidb
Check "program removed" (-not (Test-Path $appExe))
Check "shortcuts removed" ((Shortcuts).Count -eq 0)
Check "removed from installed apps" (-not (Test-Path $uninstallKey))
Check "user data kept after uninstall" ((Test-Path $marker) -and (Test-Path "$data\profiles\personal\sidb.db"))
Check "database unchanged by uninstall" ((Get-FileHash "$data\profiles\personal\sidb.db").Hash -eq $dbBefore)

# ---- reinstall finds the same data
$code = Install
Check "reinstall finished" ($code -eq 0 -and (Test-Path $appExe)) "exit code $code"
Check "data still there after reinstall" ((Test-Path $marker) -and (Test-Path "$data\profiles\personal\sidb.db"))
$p = Start-Process -FilePath $appExe -PassThru
Start-Sleep 10
Check "reinstalled app runs on the existing profile" (-not $p.HasExited)
Stop-Sidb

# leave the runner clean
Start-Process -FilePath "$install\Update.exe" -ArgumentList "--uninstall", "-s" -Wait -ErrorAction SilentlyContinue
Remove-Item $marker -ErrorAction SilentlyContinue

if ($failed -gt 0) { Write-Host "$failed check(s) failed"; exit 1 }
Write-Host "All Windows install checks passed"
