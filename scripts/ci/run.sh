#!/usr/bin/env bash
# Runs a command; if it fails, posts the last 40 lines of its output as an error annotation on the run page
# (readable without signing in), then fails the step. Usage: bash scripts/ci/run.sh "<label>" <command...>
label="$1"; shift
log="$(mktemp)"
"$@" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
if [ "$rc" -ne 0 ]; then
  tail -n 40 "$log" | sed -e 's/%/%25/g' -e 's/\r//g' -e 's/\x1b\[[0-9;]*[A-Za-z]//g' | awk 'BEGIN{ORS="%0A"} {print}' > "$log.tail"
  echo "::error title=${label} failed (exit ${rc})::$(cat "$log.tail")"
fi
rm -f "$log" "$log.tail"
exit "$rc"
