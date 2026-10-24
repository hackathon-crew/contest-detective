#!/bin/bash
set -euo pipefail

# This driver is intentionally limited to disposable hosted CI. It does not use
# Accessibility, AppleScript, screen-capture permission, or external services.
[[ "$(uname -s)" == Darwin ]] || { echo 'Native smoke requires macOS.' >&2; exit 1; }
[[ "${GITHUB_ACTIONS:-}" == true ]] || { echo 'Run this isolated smoke only in GitHub Actions.' >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="$ROOT/.build/unsigned/InkpawCompanion.app"
BIN="$APP/Contents/MacOS/InkpawCompanion"
[[ -x "$BIN" ]] || { echo 'Build and package the native app first.' >&2; exit 1; }
[[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP/Contents/Info.plist")" == org.hackathon-crew.inkpaw.companion ]]
OUTPUT="${RUNNER_TEMP:?}/inkpaw-ui-smoke-${GITHUB_RUN_ID:?}-${GITHUB_RUN_ATTEMPT:?}"
[[ ! -e "$OUTPUT" ]] || { echo 'Refusing to overwrite smoke evidence.' >&2; exit 1; }
mkdir "$OUTPUT"

PID=''
cleanup() {
  if [[ -n "$PID" ]] && kill -0 "$PID" 2>/dev/null; then
    kill -TERM "$PID" 2>/dev/null || true
    sleep 1
    kill -KILL "$PID" 2>/dev/null || true
    wait "$PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

"$BIN" --ui-smoke-output "$OUTPUT/evidence" > "$OUTPUT/app.log" 2>&1 &
PID=$!
START=$(date +%s)
while kill -0 "$PID" 2>/dev/null; do
  if (( $(date +%s) - START >= 75 )); then
    printf '{"status":"failed","reason":"native smoke exceeded 75 seconds"}\n' > "$OUTPUT/driver.json"
    echo 'Native smoke timed out; inspect the preserved app log.' >&2
    exit 1
  fi
  sleep 1
done
set +e
wait "$PID"
STATUS=$?
set -e
RUN_PID="$PID"
PID=''
printf '{"app_exit_code":%d,"architecture":"%s"}\n' "$STATUS" "$(uname -m)" > "$OUTPUT/driver.json"

# Preserve only crash reports for this exact disposable app process. Reading the
# system-generated report changes no debugger, signing, or privacy permission.
python3 - "$OUTPUT" "$RUN_PID" "$START" "$STATUS" "$BIN" <<'PY'
import json
import re
import sys
import time
from pathlib import Path

output, pid, started, status, binary = sys.argv[1:]
output = Path(output)
if int(status) >= 128:
    deadline = time.monotonic() + 10
    directory = Path.home() / 'Library/Logs/DiagnosticReports'
    saved = []
    while not saved and time.monotonic() < deadline:
        for path in directory.glob('InkpawCompanion*'):
            try:
                if path.is_symlink() or not path.is_file():
                    continue
                info = path.stat()
                if info.st_mtime < int(started) or info.st_size > 8 * 1024 * 1024:
                    continue
                text = path.read_text(errors='replace')
            except OSError:
                # CrashReporter may still be moving/writing its report.
                continue
            matches = False
            if path.suffix == '.ips':
                try:
                    report = json.loads(text.split('\n', 1)[1])
                    matches = (report.get('pid') == int(pid) and
                               report.get('procName') == 'InkpawCompanion' and
                               report.get('bundleInfo', {}).get('CFBundleIdentifier') ==
                               'org.hackathon-crew.inkpaw.companion' and
                               (report.get('procPath') == binary or
                                report.get('procPath', '').startswith('/<private>/')))
                except (ValueError, IndexError):
                    pass
            elif path.suffix == '.crash':
                matches = bool(re.search(r'^Process:\s+InkpawCompanion\s+\[' + re.escape(pid) + r'\]', text, re.MULTILINE))
                matches = matches and bool(re.search(r'^Path:\s+' + re.escape(binary) + r'\s*$', text, re.MULTILINE))
            if matches:
                target = output / ('own-process-crash-' + str(len(saved)) + path.suffix)
                target.write_text(text)
                saved.append(target.name)
        if not saved:
            time.sleep(0.5)
    (output / 'crash-diagnostics.json').write_text(json.dumps({'pid': int(pid), 'files': saved,
        'scope': 'exact app PID and binary path; no other process reports collected'}) + '\n')
PY

[[ -f "$OUTPUT/evidence/smoke.json" ]] || { echo 'Native app produced no smoke report.' >&2; exit 1; }
python3 - "$OUTPUT/evidence/smoke.json" "$STATUS" <<'PY'
import json
import sys
from pathlib import Path

report = json.loads(Path(sys.argv[1]).read_text())
code = int(sys.argv[2])
status = report.get('status')
expected = {0: 'passed', 77: 'unsupported'}.get(code)
if expected is None or status != expected:
    raise SystemExit(f'Native smoke failed: exit={code}, status={status!r}')
print(f'Native smoke status: {status}')
PY

if [[ "$STATUS" == 77 ]]; then
  echo '::warning::Hosted runner lacks a required GUI/rendering capability. No visual pass is claimed; inspect smoke.json.'
else
  echo 'Actual packaged-app launch, geometry, and native render smoke passed.'
fi
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  {
    echo '### Native app smoke'
    if [[ "$STATUS" == 0 ]]; then
      echo 'Packaged app launch, geometry, and native pixel checks passed. Inspect the separate RealityKit scene and workspace-content PNGs in the evidence artifact.'
    else
      echo 'GUI/rendering capability unsupported on this runner. Compilation and unit tests do not establish visual verification.'
    fi
    echo 'No Screen Recording or Accessibility permissions were requested. These are own-render exports, not a composited operating-system screenshot. Interactive drag, focus, Spaces, and multiple displays remain separate manual checks.'
  } >> "$GITHUB_STEP_SUMMARY"
fi
