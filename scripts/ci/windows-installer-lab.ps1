# Diagnostic lab for the Windows installer. CI ONLY (throwaway runner). Results go out as a few large annotations.
param([Parameter(Mandatory = $true)][string]$Version)
$ErrorActionPreference = "Continue"
if ($env:GITHUB_ACTIONS -ne "true") { throw "lab only runs on GitHub Actions" }

function Fail-Annotate([string]$m) { Write-Host "::error title=LAB crashed::$($m.Replace('%','%25').Replace("`r",'').Replace("`n",'%0A'))" }
trap { Fail-Annotate "$($_.Exception.Message)`n$($_.ScriptStackTrace)"; exit 1 }
$ErrorActionPreference = "Stop"
$listing = Get-ChildItem out -Recurse -ErrorAction SilentlyContinue | ForEach-Object { $_.FullName.Replace((Get-Location).Path, "") + " (" + $_.Length + ")" }
Write-Host "::warning title=LAB - files in out::$(($listing -join "`n").Replace('%','%25').Replace("`n",'%0A'))"
$setup = (Get-ChildItem out -Recurse -Filter "SIDB-$Version-Setup.exe" | Select-Object -First 1).FullName
if (-not $setup) { throw "Setup.exe not found in the downloaded artifact" }
$ErrorActionPreference = "Continue"
$install = Join-Path $env:LOCALAPPDATA "SIDB"
$sqTemp = Join-Path $env:LOCALAPPDATA "SquirrelTemp"
$data = Join-Path ([Environment]::GetFolderPath("ApplicationData")) "SIDB"
$tmp = $env:RUNNER_TEMP

function Annotate([string]$title, [string[]]$lines) {
  $text = (($lines | Where-Object { $_ -ne $null }) -join "`n").Replace("`r", "")
  if ($text.Length -gt 12000) { $text = "...(shortened)`n" + $text.Substring($text.Length - 12000) }
  Write-Host "::warning title=LAB - ${title}::$($text.Replace('%','%25').Replace("`n",'%0A'))"
}

function Kill-All { foreach ($n in "SIDB", "Update", "squirrel", "SIDB-$Version-Setup") { Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }; Start-Sleep 2 }

function Clean {
  Kill-All
  Remove-Item -Recurse -Force $install, $sqTemp, $data -ErrorAction SilentlyContinue
  Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs", ([Environment]::GetFolderPath("Desktop")) -Recurse -Filter "SIDB*" -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\SIDB" -Recurse -ErrorAction SilentlyContinue
}

function Procs {
  Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(SIDB|Update|squirrel|Setup)' -or $_.CommandLine -match 'SIDB|Squirrel' } |
    Where-Object { $_.CommandLine -notmatch '--type=(renderer|gpu-process|utility|crashpad)' -and $_.Name -notmatch 'pwsh|powershell|Runner' } |
    ForEach-Object { $c = "$($_.CommandLine)"; "{0} pid {1} ppid {2} started {3:HH:mm:ss} :: {4}" -f $_.Name, $_.ProcessId, $_.ParentProcessId, $_.CreationDate, $c.Substring(0, [Math]::Min(200, $c.Length)) }
}

function Registry-Lines {
  foreach ($r in "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall", "HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall") {
    Get-ChildItem $r -ErrorAction SilentlyContinue | ForEach-Object {
      $p = Get-ItemProperty $_.PSPath -ErrorAction SilentlyContinue
      $all = ($p.PSObject.Properties | Where-Object { $_.Name -notmatch '^PS' } | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join "; "
      if ($_.PSChildName -match 'SIDB' -or $all -match 'SIDB') { "$($_.PSChildName) :: $all" }
    }
  }
}

function Logs([string]$what) {
  $files = @()
  $files += Get-ChildItem $sqTemp -Filter "*.log" -ErrorAction SilentlyContinue
  $files += Get-ChildItem $install -Recurse -Depth 3 -Filter "*.log" -ErrorAction SilentlyContinue
  foreach ($f in $files | Sort-Object FullName -Unique) {
    "== $($f.Name) in $($f.DirectoryName.Replace($env:LOCALAPPDATA,'%LOCALAPPDATA%'))"
    Get-Content $f.FullName -Tail 40 -ErrorAction SilentlyContinue
  }
}

# Runs Setup.exe (or another command), waits up to $wait seconds for THAT process, reports.
function Experiment([string]$name, [string]$file, [string[]]$arguments, [int]$wait, [int]$killSidbAfter = 0, [string]$workDir = $null) {
  Clean
  $out = Join-Path $tmp "$name.out.txt"; $err = Join-Path $tmp "$name.err.txt"
  $splat = @{ FilePath = $file; PassThru = $true; RedirectStandardOutput = $out; RedirectStandardError = $err }
  if ($arguments) { $splat.ArgumentList = $arguments }
  if ($workDir) { $splat.WorkingDirectory = $workDir }
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $p = Start-Process @splat
  $null = $p.Handle
  $lines = @("command: $file $($arguments -join ' ')")
  Start-Sleep 25
  $lines += "== at 25 s, still running: $(-not $p.HasExited)"
  $lines += Procs
  if ($killSidbAfter -gt 0) { Get-Process SIDB -ErrorAction SilentlyContinue | Stop-Process -Force; $lines += "(SIDB stopped at $([int]$sw.Elapsed.TotalSeconds) s)" }
  $exited = $p.WaitForExit($wait * 1000)
  $lines += "== exited within $wait s: $exited; code: $(if ($exited) { $p.ExitCode } else { 'n/a' }); after $([int]$sw.Elapsed.TotalSeconds) s"
  if (-not $exited) { $lines += "== processes at the end"; $lines += Procs; & taskkill /F /T /PID $p.Id 2>&1 | Out-Null }
  $lines += "== uninstall registry entries: $(@(Registry-Lines).Count)"; $lines += Registry-Lines
  $lines += "== program folder exists: $(Test-Path "$install\app-$Version\SIDB.exe"); shortcuts: $(@(Get-ChildItem "$env:APPDATA\Microsoft\Windows\Start Menu\Programs" -Recurse -Filter 'SIDB*.lnk' -ErrorAction SilentlyContinue).Count)"
  $lines += "== stdout/stderr"; $lines += Get-Content $out -ErrorAction SilentlyContinue; $lines += Get-Content $err -ErrorAction SilentlyContinue
  $lines += Logs $name
  Kill-All
  Annotate $name $lines
}

Write-Host "runner: $([Environment]::OSVersion.VersionString)"

# A: the normal installer, as users run it, and SIDB closed after 25 s (baseline from run #10)
Experiment "A normal Setup.exe (SIDB closed at 25 s)" $setup @() 60 1

# B: silent install: no splash window and no first-run start of SIDB
Experiment "B Setup.exe --silent" $setup @("--silent") 90

# C: run Update.exe --install directly, from a copy of what Setup.exe unpacked, to see its own error output
Clean
$p = Start-Process -FilePath $setup -PassThru; Start-Sleep 25; Kill-All
Remove-Item -Recurse -Force (Join-Path $tmp "sqcopy") -ErrorAction SilentlyContinue
Copy-Item -Recurse $sqTemp (Join-Path $tmp "sqcopy") -ErrorAction SilentlyContinue
$copyList = Get-ChildItem (Join-Path $tmp "sqcopy") -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Name) ($($_.Length))" }
Experiment "C Update.exe --install (direct, with output)" (Join-Path $tmp "sqcopy\Update.exe") @("--install", ".") 90 1 (Join-Path $tmp "sqcopy")
Annotate "C files Setup.exe had unpacked" $copyList

# D: direct, silent
Clean
Experiment "D Update.exe --install --silent (direct)" (Join-Path $tmp "sqcopy\Update.exe") @("--install", ".", "--silent") 90 0 (Join-Path $tmp "sqcopy")

Clean
Write-Host "lab finished"
exit 0
