#!/usr/bin/env bash
# Run a `go test -json …` command, print what a plain `go test` would print
# (test output and compiler errors), and fail when the tests fail OR when any
# test was skipped. testx skips a test when its database is not configured, so
# in the integration gate a skip means "nothing was tested" and must not pass
# as green.
#
# usage: scripts/no-skips.sh go test -tags=integration -count=1 -json ./...
#        scripts/no-skips.sh --self-test   (pass, skip, fail, build failure,
#                                           unwritable log and missing -json,
#                                           with jq and without)
set -uo pipefail

script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"

use_jq() { [ -z "${NO_SKIPS_NO_JQ:-}" ] && command -v jq >/dev/null 2>&1; }

# The awk fallback decodes JSON strings: \n \t \r \" \\ \/ and \uXXXX (Go
# writes < > & as < > &). Lines that are not JSON are printed
# as they are.
awk_lib='
function hexval(h,   i, c, v) {
	v = 0
	for (i = 1; i <= length(h); i++) {
		c = index("0123456789abcdef", tolower(substr(h, i, 1))) - 1
		v = v * 16 + c
	}
	return v
}
function unescape(s,   out, i, c, n, cp) {
	out = ""
	for (i = 1; i <= length(s); i++) {
		c = substr(s, i, 1)
		if (c != "\\") { out = out c; continue }
		n = substr(s, ++i, 1)
		if (n == "n") out = out "\n"
		else if (n == "t") out = out "\t"
		else if (n == "r") out = out "\r"
		else if (n == "u") {
			cp = hexval(substr(s, i + 1, 4)); i += 4
			out = out (cp < 128 ? sprintf("%c", cp) : "?")
		}
		else out = out n # \" \\ \/
	}
	return out
}
function field(name,   v) { # raw value of a top-level string field
	v = $0
	if (!sub(".*\"" name "\":\"", "", v)) return ""
	match(v, /^([^"\\]|\\.)*/)
	return substr(v, 1, RLENGTH)
}
'

# print_events: JSON events on stdin -> the human-readable output.
print_events() {
	if use_jq; then
		jq --unbuffered -Rrj '(fromjson? // {Action: "raw", Output: (. + "\n")})
			| select(.Action == "output" or .Action == "build-output" or .Action == "raw")
			| .Output // empty'
	else
		awk "$awk_lib"'
			!/^{/ { print; fflush(); next }
			/"Action":"(build-)?output"/ { printf "%s", unescape(field("Output")); fflush() }'
	fi
}

# list_skips FILE: one "  <package> <test>" line per skipped test. A "skip"
# event without a Test is a package with no test files, which is fine.
list_skips() {
	if use_jq; then
		jq -Rr 'fromjson? | select(.Action == "skip" and .Test != null) | "  \(.Package) \(.Test)"' "$1"
	else
		awk "$awk_lib"'/"Action":"skip"/ && /"Test":"/ { print "  " unescape(field("Package")) " " unescape(field("Test")) }' "$1"
	fi
}

run() {
	local a has_json=0 log status tee_status skipped
	for a in "$@"; do [ "$a" = "-json" ] && has_json=1; done
	if [ $has_json -eq 0 ]; then
		echo "no-skips: refusing to run: the command has no -json flag, so skips cannot be detected" >&2
		echo "usage: $0 go test -json <packages>" >&2
		return 2
	fi

	# NO_SKIPS_SELFTEST_LOG lets the self-test point tee at a path it cannot
	# write; that file is never deleted, only the mktemp one is.
	if [ -n "${NO_SKIPS_SELFTEST_LOG:-}" ]; then
		log=$NO_SKIPS_SELFTEST_LOG
	else
		log=$(mktemp)
		trap 'rm -f "$log"' RETURN
	fi
	"$@" | tee "$log" | print_events
	# Copy both statuses at once: the next command resets PIPESTATUS.
	status=${PIPESTATUS[0]} tee_status=${PIPESTATUS[1]}

	# The skip check reads the log tee wrote. If tee could not write it, an
	# empty log would look like "no test was skipped", so that must fail.
	if [ "$tee_status" -ne 0 ]; then
		echo "no-skips: could not record the test events (tee exit $tee_status), so skips cannot be checked"
		return 2
	fi

	skipped=$(list_skips "$log")
	if [ -n "$skipped" ]; then
		echo "no-skips: these tests were skipped, so the gate fails:"
		echo "$skipped"
		echo "no-skips: start the dependencies and export their env vars (make test-integration does both)"
		return 1
	fi
	if [ "$status" -ne 0 ]; then
		echo "no-skips: tests failed (exit $status)"
		return "$status"
	fi
	echo "no-skips: ok, no test was skipped"
}

self_test() {
	local tmp out rc failed=0 mode
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"' RETURN
	mkdir -p "$tmp/p"
	printf 'module selftest\n\ngo 1.24\n' > "$tmp/go.mod"
	cat > "$tmp/p/p_test.go" <<'EOF'
package p

import (
	"os"
	"testing"
)

func TestPass(t *testing.T) { t.Log("decoded: a<b>&c \\ \"q\"") }

func TestMaybeSkip(t *testing.T) {
	if os.Getenv("SELFTEST_SKIP") != "" {
		t.Skip("POSTGRES_DSN not set")
	}
}

func TestMaybeFail(t *testing.T) {
	if os.Getenv("SELFTEST_FAIL") != "" {
		t.Fatal("boom")
	}
}
EOF
	cat > "$tmp/p/broken_test.go" <<'EOF'
//go:build broken

package p

func init() { undefinedThing() }
EOF

	fail() { echo "self-test [$mode]: $*"; failed=1; }
	expect() { # expect <exit> <text> <env…> -- runs the scanner in $tmp
		local want_rc=$1 want_text=$2
		shift 2
		out=$(cd "$tmp" && env "$@" "$script_path" go test -count=1 -json ./... 2>&1)
		rc=$?
		[ "$rc" -eq "$want_rc" ] || fail "$*: expected exit $want_rc, got $rc"
		grep -qF -- "$want_text" <<<"$out" || fail "$*: output lacks: $want_text"
	}

	for mode in jq awk; do
		if [ $mode = jq ] && ! command -v jq >/dev/null 2>&1; then continue; fi
		local no_jq=NO_SKIPS_NO_JQ=
		[ $mode = awk ] && no_jq=NO_SKIPS_NO_JQ=1
		expect 0 'decoded: a<b>&c \ "q"' "$no_jq"
		expect 0 'no-skips: ok' "$no_jq"
		expect 1 'selftest/p TestMaybeSkip' "$no_jq" SELFTEST_SKIP=1
		expect 1 'boom' "$no_jq" SELFTEST_FAIL=1
		expect 1 'undefined: undefinedThing' "$no_jq" GOFLAGS=-tags=broken
		# tee cannot write the log, so a skip would go unseen: must fail.
		expect 2 'could not record the test events' "$no_jq" SELFTEST_SKIP=1 \
			NO_SKIPS_SELFTEST_LOG="$tmp/missing-dir/events.json"
	done

	mode=args
	out=$("$script_path" go test ./... 2>&1)
	rc=$?
	[ $rc -eq 2 ] || fail "missing -json: expected exit 2, got $rc"

	if [ $failed -ne 0 ]; then
		echo "--- last output ---"
		echo "$out"
		return 1
	fi
	echo "no-skips self-test: ok (pass, skip, fail, build failure, unwritable log with jq and awk decoding; missing -json refused)"
}

case "${1:-}" in
--self-test) self_test ;;
"") echo "usage: $0 go test -json <packages> | --self-test" >&2; exit 2 ;;
*) run "$@" ;;
esac
