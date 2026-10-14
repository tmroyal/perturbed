#!/bin/sh
# Runs the tests a change needs, picked from the files that changed since the last commit:
#   tests/run.sh               the suites for what changed (everything, if nothing has)
#   tests/run.sh --all         every suite: before a push
#   tests/run.sh cli adhoc     these suites (timing generators protocol cli adhoc)
# Lint always runs (1 s). The other suites start a brain in test mode on its own port; timing and
# generators play real notes in real time (9 s and 37 s), so they run only when a change can alter
# which notes play or when. They send MIDI on IAC Bus 1 channels 1–2 (Live tracks listening there
# will play it) and CCs on Bus 2.
cd "$(dirname "$0")/.."

# What a changed file can break -> the suites that would notice.
suites_for() {
  case "$1" in
    *.md|docs/*|performances/*|local/*|ableton/*|.gitignore) ;;                       # nothing to run
    surface/*|biome.jsonc|package.json|package-lock.json) ;;                            # lint only: the surface has no automatic test
    tools/*) echo "cli adhoc" ;;
    tests/timing.scd) echo "timing" ;;
    tests/generators.scd) echo "generators" ;;
    tests/protocol.js) echo "protocol" ;;
    tests/cli.js) echo "cli" ;;
    tests/adhoc.js|tests/adhoc/*|adhoc/*|brain/core/library.scd) echo "adhoc cli" ;;
    brain/core/osc.scd|brain/core/persist.scd|brain/core/json.scd|brain/core/objects.scd) echo "protocol cli" ;;
    brain/core/groups.scd|brain/core/globals.scd|brain/core/destinations.scd) echo "protocol cli" ;;   # state, not the timing of sound
    brain/core/chord.scd|brain/core/keyboard.scd|brain/types/chord.scd|brain/types/lfo.scd) echo "generators cli" ;;
    brain/core/pitch.scd|brain/core/rhythm.scd|brain/core/velocity.scd|brain/types/*) echo "generators" ;;   # which notes play
    brain/core/clock.scd|brain/core/midi.scd) echo "timing generators" ;;              # when they play
    *) echo "timing generators protocol cli adhoc" ;;                                   # the core everything shares, the runner, anything new
  esac
}
ALL="timing generators protocol cli adhoc"
if [ "$1" = "--all" ]; then
  SUITES=$ALL; echo "running everything (--all)"
elif [ $# -gt 0 ]; then
  SUITES="$*"; echo "running: $SUITES"
else
  CHANGED=$( { git diff --name-only HEAD; git ls-files --others --exclude-standard; } 2>/dev/null | sort -u)
  if [ -z "$CHANGED" ]; then
    SUITES=$ALL; echo "nothing changed since the last commit: running everything"
  else
    SUITES=$(echo "$CHANGED" | while IFS= read -r f; do suites_for "$f"; done | tr ' ' '\n' | sort -u | tr '\n' ' ')
    echo "changed: $(echo $CHANGED | tr '\n' ' ')"
    echo "running: lint ${SUITES:-(nothing else: no suite covers these files)}"
  fi
fi
want() { case " $SUITES " in *" $1 "*) return 0 ;; esac; return 1; }

# lint and format check for the JavaScript (Biome; npm install at the repo root once)
if [ -x node_modules/.bin/biome ]; then
  node_modules/.bin/biome check . --reporter=summary > /tmp/perturbed-lint.$$ 2>&1 && echo "LINT PASSED" || { cat /tmp/perturbed-lint.$$; echo "LINT FAILED (npm run format fixes formatting)"; lint_failed=1; }
  rm -f /tmp/perturbed-lint.$$
else
  echo "LINT SKIPPED (npm install at the repo root to enable)"
fi
if [ -z "$(echo $SUITES)" ]; then [ -n "$lint_failed" ] && exit 1; exit 0; fi

# The test brain gets its own port so tests never touch a live brain on 57120.
export PERFORMED_PORT=57140
SCLANG=/Applications/SuperCollider.app/Contents/MacOS/sclang
LOG=$(mktemp -t brain)
# the test brain's type library: a temp copy of the fixtures, so tests never touch adhoc/
export PERFORMED_ADHOC=$(mktemp -d -t adhoc)
cp tests/adhoc/*.scd "$PERFORMED_ADHOC"
limit() { perl -e 'alarm shift; exec @ARGV' "$@"; }

PERFORMED_TEST=1 perl -e 'alarm shift; exec @ARGV' 90 "$SCLANG" brain/main.scd > "$LOG" 2>&1 &
BRAIN=$!
trap '{ kill -9 $BRAIN; wait $BRAIN; } 2>/dev/null; rm -rf "$PERFORMED_ADHOC"' EXIT

for _ in $(seq 50); do grep -q "brain ready" "$LOG" && break; sleep 0.2; done
if ! grep -q "brain ready" "$LOG"; then echo "brain did not start:"; tail -30 "$LOG"; exit 1; fi
grep "brain ready" "$LOG"

status=0
if want timing; then
  OUT=$(limit 20 "$SCLANG" tests/timing.scd 2>&1)
  echo "$OUT" | grep -E "^(ok|FAIL|gen |TIMING|ERROR)"
  echo "$OUT" | grep -q "TIMING PASSED" || status=1
fi
if want generators; then
  OUT=$(limit 50 "$SCLANG" tests/generators.scd 2>&1)
  echo "$OUT" | grep -E "^(ok|FAIL|GENERATORS|ERROR)"
  echo "$OUT" | grep -q "GENERATORS PASSED" || status=1
fi
if want protocol; then limit 10 node tests/protocol.js || status=1; fi
if want cli; then limit 30 node tests/cli.js || status=1; fi
if want adhoc; then limit 20 node tests/adhoc.js || status=1; fi

# (cli.js loads a missing file and sets a locked setting, adhoc.js loads broken types, on purpose: those messages are expected)
grep -E "ERROR|WARNING: [^A]" "$LOG" | grep -v "load failed\|_FileLength\|broken\|crashy\|noSuchMethod\|didn't load\|unexpected INTEGER\|Command line parse\|follows \|can't map\|onChange for boom\|has no file yet\|doesn't parse\|nonsense\|unexpected\|Parse error" && echo "(brain log: $LOG)"
[ -n "$lint_failed" ] && status=1
exit $status
