# Install, uninstall and reinstall test of the Windows installer. CI ONLY: it installs SIDB for the current user on a
# throwaway GitHub Actions runner. It refuses to run anywhere else, and refuses to run if SIDB data already exists.
#
# Waiting: "Start-Process -Wait" also waits for every program the started one launches (the installer starts SIDB, so it
# never returned: the 15 minute timeout in run #7). Here only the started process is waited for, with a time limit.
#
# Reporting: GitHub shows at most 10 annotations per step and the job log needs a login to read, so passing checks only
# go to the log, failures are errors, and diagnostics are collected into a few large warnings.
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
$tmp = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$failed = 0
$results = New-Object System.Collections.Generic.List[string]
$TIMED_OUT = -999 # a real exit code can never be this, so "timed out" is never confused with "failed"

function Say([string]$text) { Write-Host ("[{0:HH:mm:ss}] {1}" -f (Get-Date), $text) }

function Check([string]$name, [bool]$ok, [string]$detail = "") {
  $line = if ($detail) { "$name ($detail)" } else { $name }
  $results.Add("$(if ($ok) { 'PASS' } else { 'FAIL' })  $line")
  if ($ok) { Write-Host "PASS  $line" }
  else { Write-Host "FAIL  $line"; Write-Host "::error title=Windows install test::FAIL $line"; $script:failed++ }
}

# One annotation = one warning with a title and a body (newlines encoded for GitHub).
function Annotate([string]$title, [string[]]$lines) {
  $text = (($lines | Where-Object { $_ }) -join "`n").Replace("`r", "")
  if ($text.Length -gt 12000) { $text = "...(shortened)`n" + $text.Substring($text.Length - 12000) }
  $text = $text.Replace("%", "%25").Replace("`n", "%0A")
  Write-Host "::warning title=Windows install test - ${title}::$text"
}

function Stop-Named([string[]]$names) {
  foreach ($n in $names) { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
  Start-Sleep 2
}
function Stop-Sidb { Stop-Named @("SIDB") }
function Stop-All { Stop-Named @("SIDB", "Update", "squirrel", "SIDB-$Version-Setup") }

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

function Process-Lines {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^(SIDB|Update|squirrel)' -or $_.ExecutablePath -like "*\SIDB*" } |
    Where-Object { $_.CommandLine -notmatch '--type=(renderer|gpu-process|utility|crashpad)' } |
    ForEach-Object { $cl = "$($_.CommandLine)"; "$($_.Name) pid $($_.ProcessId) parent $($_.ParentProcessId) :: $($cl.Substring(0, [Math]::Min(220, $cl.Length)))" }
}

# What Windows lists as installed apps (any entry mentioning SIDB), as Settings > Apps would read it.
function Uninstall-Entries {
  $roots = @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall")
  foreach ($r in $roots) {
    Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
      $props = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      $all = ($props.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "; "
      if ($_.PSChildName -match 'SIDB' -or $all -match 'SIDB') { "$r\$($_.PSChildName) :: $all" }
    }
  }
}

function Show-Diagnostics([string]$when) {
  Say "--- diagnostics ($when)"
  $lines = @("== processes") + (Process-Lines)
  $lines += "== install folder"
  $lines += Get-ChildItem $install -Recurse -Depth 1 -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Replace($install, "") + $(if (-not $_.PSIsContainer) { "  ($($_.Length) bytes)" }) }
  $lines += "== installed-apps registry entries mentioning SIDB"
  $lines += (Uninstall-Entries)
  $logs = @()
  $logs += Get-ChildItem $install -Recurse -Depth 3 -Filter "*.log" -ErrorAction SilentlyContinue
  $logs += Get-ChildItem (Join-Path $env:LOCALAPPDATA "SquirrelTemp") -Filter "*.log" -ErrorAction SilentlyContinue
  $logs += Get-ChildItem (Join-Path $data "logs") -Filter "*.log" -ErrorAction SilentlyContinue
  foreach ($l in ($logs | Sort-Object FullName -Unique)) {
    $lines += "== $($l.FullName.Replace($env:LOCALAPPDATA, '%LOCALAPPDATA%').Replace($env:APPDATA, '%APPDATA%')) (last 30 lines)"
    $lines += Get-Content $l.FullName -Tail 30 -ErrorAction SilentlyContinue
  }
  Annotate "diagnostics ($when)" $lines
}

# Starts a program and waits for THAT process only. Output goes to files (no pipes to keep open).
# Returns @{ Code; Output } where Code is the exit code or $TIMED_OUT.
function Run-Program([string]$file, [string[]]$arguments, [int]$timeoutSeconds, [string]$name) {
  $out = Join-Path $tmp "$name.out.txt"
  $err = Join-Path $tmp "$name.err.txt"
  $splat = @{ FilePath = $file; PassThru = $true; RedirectStandardOutput = $out; RedirectStandardError = $err }
  if ($arguments) { $splat.ArgumentList = $arguments }
  $p = Start-Process @splat
  $null = $p.Handle # keeps the handle open so ExitCode can be read after the process ends
  $code = $null
  if ($p.WaitForExit($timeoutSeconds * 1000)) { $code = $p.ExitCode }
  else {
    Say "timed out after $timeoutSeconds s: $name"
    Annotate "$name still running after $timeoutSeconds s" (Process-Lines)
    & taskkill /F /T /PID $p.Id 2>&1 | Out-Null
    $code = $TIMED_OUT
  }
  $text = @((Get-Content $out -ErrorAction SilentlyContinue), (Get-Content $err -ErrorAction SilentlyContinue)) | Where-Object { $_ }
  return @{ Code = $code; Output = $text }
}

# Runs the installer the way a user does (double-click): it installs, then starts SIDB. SIDB is closed after its first
# start, and the installer must then finish. Reports whether the installer was still running while SIDB was open.
function Install([string]$label) {
  Stop-All
  Say "${label}: running the installer"
  $p = Start-Process -FilePath $setup -PassThru
  $null = $p.Handle
  $up = Wait-Until { (Test-Path $appExe) -and (@(Get-Process SIDB -ErrorAction SilentlyContinue).Count -gt 0) } 120
  Start-Sleep 15 # let the first start settle (it creates the database)
  $stillRunning = -not $p.HasExited
  Say "${label}: SIDB started: $up; installer still running while SIDB is open: $stillRunning"
  Stop-Sidb
  $code = $null
  if ($p.WaitForExit(60000)) { $code = $p.ExitCode }
  else {
    Annotate "${label}: installer still running 60 s after SIDB was closed" (Process-Lines)
    & taskkill /F /T /PID $p.Id 2>&1 | Out-Null
    $code = $TIMED_OUT
  }
  Say "${label}: installer exit code $code"
  return @{ Code = $code; SidbStarted = $up; WaitedForApp = $stillRunning }
}

# ---- isolation: this must be a clean machine. Existing SIDB data is never touched.
Say "checking that the runner has no SIDB data or install"
if ((Test-Path $data) -or (Test-Path $install)) { throw "SIDB data or an install already exists on this machine ($data / $install); refusing to run." }
Check "installer exists" (Test-Path $setup) $setup

# ---- install
$r = Install "install"
Check "SIDB started after the installer finished" $r.SidbStarted
Check "installer exits once SIDB is closed" ($r.Code -eq 0) "exit code $($r.Code); it was still running while SIDB was open: $($r.WaitedForApp)"
Check "program installed for this user" (Test-Path $appExe) $appExe
Check "update helper installed" (Test-Path $updateExe)
$links = Shortcuts
Check "Start menu / desktop shortcuts created" ($links.Count -gt 0) (($links | ForEach-Object { $_.FullName.Replace($env:USERPROFILE, "~") }) -join ", ")
$entries = @(Uninstall-Entries)
Check "listed in installed apps (with an uninstall command)" (($entries.Count -gt 0) -and ($entries -match "UninstallString")) "$($entries.Count) entr(ies)"
Check "first start created the profile" (Test-Path $db) $data
Show-Diagnostics "after install"

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
Stop-All

# ---- uninstall keeps user data
$marker = Join-Path $data "sidb-ci-marker.txt"
"keep me" | Out-File $marker
$dbBefore = (Get-FileHash $db).Hash
Say "uninstall"
$u = Run-Program $updateExe @("--uninstall", "-s") 120 "uninstall"
Say "uninstall: Update.exe exited with $($u.Code)"
$gone = Wait-Until { -not (Test-Path $appExe) } 60
Stop-All
Check "uninstaller finished" ($u.Code -eq 0) "exit code $($u.Code)"
Check "program removed" $gone
Check "shortcuts removed" ((Shortcuts).Count -eq 0)
Check "removed from installed apps" (@(Uninstall-Entries).Count -eq 0)
Check "user data kept after uninstall" ((Test-Path $marker) -and (Test-Path $db))
Check "database unchanged by uninstall" ((Test-Path $db) -and ((Get-FileHash $db).Hash -eq $dbBefore))
if ($u.Output) { Annotate "uninstall output" $u.Output }
Show-Diagnostics "after uninstall"

# ---- reinstall finds the same data
$r = Install "reinstall"
Check "reinstall: installer exits once SIDB is closed" ($r.Code -eq 0) "exit code $($r.Code)"
Check "reinstall: program installed" (Test-Path $appExe)
Check "data still there after reinstall" ((Test-Path $marker) -and (Test-Path $db))
Say "reinstalled app on the existing profile"
$p = Start-Process -FilePath $appExe -PassThru
Start-Sleep 10
Check "reinstalled app runs on the existing profile" (-not $p.HasExited)
Stop-All

# ---- leave the runner clean
Say "final uninstall"
$null = Run-Program $updateExe @("--uninstall", "-s") 120 "final-uninstall"
Remove-Item $marker -ErrorAction SilentlyContinue

Write-Host "::notice title=Windows install test - all checks::$((($results -join "`n").Replace('%','%25')).Replace("`n",'%0A'))"
if ($failed -gt 0) { Show-Diagnostics "end"; Write-Host "$failed check(s) failed"; exit 1 }
Write-Host "All Windows install checks passed"
exit 0
