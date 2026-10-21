#!/usr/bin/env bash
# Run Go unit tests for a module and fail when statement coverage is below a
# threshold. Generated code (sqlc output, *_gen.go) and cmd/ entrypoints are
# excluded, because tests there would only re-test generated or wiring code.
#
# usage: scripts/go-coverage.sh <module-dir> <min-percent>
set -euo pipefail

dir=${1:?module dir}
min=${2:?minimum percent}
profile=$(mktemp)
trap 'rm -f "$profile" "$profile.f"' EXIT

cd "$dir"
go test -count=1 -coverprofile="$profile" ./...

# Keep the mode line, drop excluded files.
grep -vE '/(cmd|internal/db/sqlc)/|_gen\.go:' "$profile" > "$profile.f" || true

if [ "$(wc -l < "$profile.f")" -le 1 ]; then
	echo "coverage: no measurable statements yet"
	exit 0
fi

total=$(go tool cover -func="$profile.f" | awk '/^total:/ {sub("%", "", $3); print $3}')
echo "coverage: ${total}% (min ${min}%)"
awk -v t="$total" -v m="$min" 'BEGIN { exit (t + 0 >= m + 0) ? 0 : 1 }' ||
	{ echo "coverage below ${min}%"; exit 1; }
