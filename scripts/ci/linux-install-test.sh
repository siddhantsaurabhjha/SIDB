#!/usr/bin/env bash
# Installs the .deb on the CI runner and checks the installed app. CI ONLY (it installs a system package).
set -u
if [ "${GITHUB_ACTIONS:-}" != "true" ]; then echo "linux-install-test.sh only runs on GitHub Actions"; exit 1; fi
version="$1"
deb="out/release/sidb_${version}_amd64.deb"
failed=0
check() { # name ok detail
  if [ "$2" = "1" ]; then echo "PASS  $1 ${3:+($3)}"; echo "::notice title=Linux install test::PASS $1 ${3:+($3)}";
  else echo "FAIL  $1 ${3:+($3)}"; echo "::error title=Linux install test::FAIL $1 ${3:+($3)}"; failed=$((failed+1)); fi
}
ok() { if "$@" >/dev/null 2>&1; then echo 1; else echo 0; fi }

check "deb package exists" "$(ok test -f "$deb")" "$deb"
sudo apt-get install -y "./$deb" >/tmp/apt.log 2>&1; rc=$?
check "deb installs with apt" "$([ $rc -eq 0 ] && echo 1 || echo 0)" "$(tail -n 1 /tmp/apt.log)"
check "program in /usr/lib/sidb" "$(ok test -x /usr/lib/sidb/SIDB)"
check "sidb command on PATH" "$(ok command -v sidb)" "$(command -v sidb)"
check "menu entry installed" "$(ok test -f /usr/share/applications/sidb.desktop)"
sandbox="$(stat -c '%a %U' /usr/lib/sidb/chrome-sandbox 2>/dev/null)"
check "Chromium sandbox helper is root-owned and setuid (sandbox stays on)" "$([ "$sandbox" = "4755 root" ] && echo 1 || echo 0)" "$sandbox"

SIDB_SMOKE_EXE=/usr/lib/sidb/SIDB SIDB_SMOKE_LABEL="Linux deb" xvfb-run -a node scripts/smoke-packaged.mjs; rc=$?
check "installed app passes the smoke test" "$([ $rc -eq 0 ] && echo 1 || echo 0)"

sudo apt-get remove -y sidb >/tmp/apt-remove.log 2>&1; rc=$?
check "deb removes cleanly" "$([ $rc -eq 0 ] && [ ! -e /usr/lib/sidb/SIDB ] && echo 1 || echo 0)"

if [ "$failed" -gt 0 ]; then echo "$failed check(s) failed"; exit 1; fi
echo "All Linux install checks passed"
