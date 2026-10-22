#!/usr/bin/env bash
# Run Go unit tests for a module and fail when statement coverage is below a
# threshold.
#
# What is measured: every package of the module except cmd/ entrypoints
# (wiring that internal/app already covers) and generated sqlc code; files
# named *_gen.go are dropped from the profile too.
#
# Every measured package must have at least one test file. That rule is
# stricter than "the total is high enough", and it also keeps `go test`
# away from packages without tests, which on Go >= 1.22 need the `covdata`
# tool that toolchains downloaded by GOTOOLCHAIN=auto do not ship.
#
# usage: scripts/go-coverage.sh <module-dir> <min-percent>
set -euo pipefail

dir=${1:?module dir}
min=${2:?minimum percent}
profile=$(mktemp)
trap 'rm -f "$profile" "$profile.f"' EXIT

cd "$dir"

# 1. The packages to measure, each with its number of test files
#    (in-package _test.go files plus external package_test ones).
listing=$(go list -f '{{.ImportPath}} {{len .TestGoFiles}} {{len .XTestGoFiles}}' ./...)
packages=()
untested=()
while read -r pkg tests xtests; do
	case "$pkg" in
	*/cmd/* | */internal/db/sqlc | */internal/db/sqlc/*) continue ;;
	esac
	packages+=("$pkg")
	if [ $((tests + xtests)) -eq 0 ]; then
		untested+=("$pkg")
	fi
done <<<"$listing"

if [ "${#packages[@]}" -eq 0 ]; then
	echo "coverage: no packages to measure yet"
	exit 0
fi

# 2. Every measured package needs tests.
if [ "${#untested[@]}" -gt 0 ]; then
	echo "coverage: these packages have no test files (every package needs tests):"
	for pkg in "${untested[@]}"; do
		echo "  - $pkg"
	done
	exit 1
fi

# 3. Test only the measured packages; all of them have tests.
go test -count=1 -coverprofile="$profile" "${packages[@]}"

# 4. Drop generated files (keeping the mode line), then check the total.
grep -vE '_gen\.go:' "$profile" > "$profile.f" || true

if [ "$(wc -l < "$profile.f")" -le 1 ]; then
	echo "coverage: no measurable statements yet"
	exit 0
fi

total=$(go tool cover -func="$profile.f" | awk '/^total:/ {sub("%", "", $3); print $3}')
echo "coverage: ${total}% (min ${min}%)"
awk -v t="$total" -v m="$min" 'BEGIN { exit (t + 0 >= m + 0) ? 0 : 1 }' ||
	{ echo "coverage below ${min}%"; exit 1; }
