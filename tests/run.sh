#!/bin/sh
# Starts the brain in test mode, runs the timing, generator, protocol, CLI and library tests against it, stops the brain.
# Sends MIDI on IAC Bus 1 channels 1–2 (Live tracks listening there will play it) and CCs on Bus 2.
cd "$(dirname "$0")/.."
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

OUT=$(limit 20 "$SCLANG" tests/timing.scd 2>&1)
echo "$OUT" | grep -E "^(ok|FAIL|gen |TIMING|ERROR)"
echo "$OUT" | grep -q "TIMING PASSED"
status=$?

OUT=$(limit 50 "$SCLANG" tests/generators.scd 2>&1)
echo "$OUT" | grep -E "^(ok|FAIL|GENERATORS|ERROR)"
echo "$OUT" | grep -q "GENERATORS PASSED" || status=1

limit 10 node tests/protocol.js || status=1
limit 30 node tests/cli.js || status=1
limit 20 node tests/adhoc.js || status=1

# (cli.js loads a missing file and adhoc.js loads broken types on purpose: those messages are expected)
grep -E "ERROR|WARNING: [^A]" "$LOG" | grep -v "load failed\|_FileLength\|broken\|crashy\|noSuchMethod\|didn't load\|unexpected INTEGER\|Command line parse" && echo "(brain log: $LOG)"
exit $status
