#!/usr/bin/env bash
# One real run of Stryker that a stop ends. It checks that Stryker loads the reporter rigor-partial from
# build/reporter.js and calls it, and that scores gives a partial score after a TERM, as at a time limit of CI.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cli="$here/../../build/cli.js"
lane="$here/mutation.json"
out="$(mktemp -d)"
partial="$here/pkg/reports/mutation/partial.jsonl"

node "$cli" config slow --lane "$lane" --concurrency 1 --out "$out/stryker.json"
cd "$here/pkg"
rm -rf reports .stryker-tmp
# setsid gives Stryker its own process group, so one TERM stops Stryker and its workers, as timeout does.
setsid pnpm exec stryker run "$out/stryker.json" > "$out/stryker.log" 2>&1 &
pid=$!
ran=0
for _ in $(seq 1 600); do
  if [ -f "$partial" ]; then ran=$(grep -cE '"status":"(Killed|Survived)"' "$partial" || true); fi
  [ "$ran" -ge 3 ] && break
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "::error::Stryker ended before the stop, with $ran tested mutants in $partial."
    cat "$out/stryker.log"
    exit 1
  fi
  sleep 0.5
done
if [ "$ran" -lt 3 ]; then echo "::error::Stryker tested $ran mutants in 5 minutes."; cat "$out/stryker.log"; exit 1; fi
kill -TERM -- "-$pid"
wait "$pid" || true
echo "== partial.jsonl"
cat "$partial"
if [ -f reports/mutation/mutation.json ]; then echo "::error::Stryker wrote mutation.json, so the check did not stop the run."; exit 1; fi

cd "$here"
code=0
node "$cli" scores slow --lane "$lane" > "$out/scores.txt" || code=$?
cat "$out/scores.txt"
if [ "$code" != 1 ]; then echo "::error::scores exited with $code, not 1: a partial score is a no read."; exit 1; fi
if ! grep -qE "^slow: .*FAIL: partial: Stryker stopped after [0-9.]+ minutes and tested [1-9][0-9]* of [1-9][0-9]* mutants\." "$out/scores.txt"; then
  echo "::error::scores gave no partial score."
  exit 1
fi
echo "The stopped run gave a partial score."
