#!/usr/bin/env bash
# Fail when the repository contains a real .env file or something that looks
# like a credential. Scans tracked files plus new files that are not ignored,
# so a secret is caught before it is committed. Findings are printed as
# file:line only, never the matched text, so the scan does not leak them.
#
# usage: scripts/secret-scan.sh              scan the repository (from any subdirectory)
#        scripts/secret-scan.sh --self-test  check the scanner on planted samples
set -uo pipefail

script_path="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
self=scripts/secret-scan.sh

# Provider key shapes. sk- keys must start at a word boundary, so slugs such
# as "task-runner-configuration-guide" are not mistaken for one.
key_pattern='(^|[^A-Za-z0-9])sk-(proj-|ant-)?[A-Za-z0-9_-]{20,}'
key_pattern+='|(AKIA|ASIA)[0-9A-Z]{16}'
key_pattern+='|(SB-)?Mid-(server|client)-[A-Za-z0-9_-]{12,}'
key_pattern+='|gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{60,}'
key_pattern+='|AIza[0-9A-Za-z_-]{35}|GOCSPX-[A-Za-z0-9_-]{28}'
key_pattern+='|xox[baprs]-[A-Za-z0-9-]{10,}'
key_pattern+='|-----BEGIN ([A-Z]+ )?PRIVATE KEY-----'

# user:password@ inside a URL, in any file. The only credentials allowed there
# are the fixed local dev login and the usual documentation placeholders.
url_pattern='://[^:/ ]+:[^@/ ]+@'
url_placeholders='^://(goshop:goshop|user:pass|USER:PASSWORD)@$'

scan() {
	local top status=0 out rc f
	# Always scan the whole repository, even when called from a subdirectory.
	# (bash 3.2 treats `cd ""` as success, so check rev-parse itself.)
	top=$(git rev-parse --show-toplevel 2>/dev/null) || {
		echo "secret-scan: not inside a git repository" >&2
		return 2
	}
	cd "$top" || return 2

	local files=()
	while IFS= read -r -d '' f; do
		# Tracked files deleted in the working tree have nothing to scan.
		[ -f "$f" ] && files+=("$f")
	done < <(git ls-files -co --exclude-standard -z)

	local envs
	envs=$(printf '%s\n' ${files[@]+"${files[@]}"} | grep -E '(^|/)(\.env(\..+)?|\.envrc)$' | grep -vE '(^|/)\.env\.example$')
	if [ -n "$envs" ]; then
		echo "secret-scan: env files must not be committed:"
		echo "$envs" | sed 's/^/  /'
		status=1
	fi

	local content=()
	for f in ${files[@]+"${files[@]}"}; do
		[ "$f" = "$self" ] || content+=("$f")
	done
	if [ ${#content[@]} -eq 0 ]; then
		[ $status -eq 0 ] && echo "secret-scan: ok (no files)"
		return $status
	fi

	# -H always prints the file name (even for a single file), and awk keeps
	# only file:line, so the matched text never reaches the output. With
	# pipefail, $? is grep's status: 0 match, 1 none, 2+ an error, which must
	# fail the scan rather than pass as "nothing found".
	out=$(grep -HnIE -- "$key_pattern" "${content[@]}" | awk -F: '{ print "  " $1 ":" $2 }' | sort -u)
	rc=$?
	if [ $rc -ge 2 ]; then echo "secret-scan: grep failed (exit $rc)"; return 2; fi
	if [ -n "$out" ]; then
		echo "secret-scan: possible credentials at:"
		echo "$out"
		status=1
	fi

	# -o prints each URL credential (file:line:match) so every one on a line is
	# checked against the placeholders; only file:line is printed.
	out=$(grep -HnoIE -- "$url_pattern" "${content[@]}" |
		awk -F: -v ok="$url_placeholders" '{ m = $0; sub(/^[^:]*:[^:]*:/, "", m); if (m !~ ok) print "  " $1 ":" $2 }' |
		sort -u)
	rc=$?
	if [ $rc -ge 2 ]; then echo "secret-scan: grep failed (exit $rc)"; return 2; fi
	if [ -n "$out" ]; then
		echo "secret-scan: URLs with embedded credentials at:"
		echo "$out"
		status=1
	fi

	[ $status -eq 0 ] && echo "secret-scan: ok"
	return $status
}

# Plant samples in throwaway repositories and check what the scanner reports.
# Samples are assembled at run time so this file never contains a complete
# fake key.
self_test() {
	local tmp out rc failed=0 caught=0 allowed=0 want deny
	tmp=$(mktemp -d)
	trap 'rm -rf "$tmp"' RETURN

	local x20=abcdefghijklmnopqrstuvwx u16=ABCDEFGHIJKLMNOP
	local leak_markers="$x20 $u16 hunter2 S3cr3tPass"

	fail() { echo "self-test: $*"; failed=1; }
	no_leaks() { # $1 = scenario name; the output must not contain sample text
		for deny in $leak_markers; do
			if grep -qF -- "$deny" <<<"$out"; then fail "$1: printed secret text ($deny)"; fi
		done
	}

	# 1. A repository with one sample per rule, allowed cases, and a subdirectory.
	mkdir -p "$tmp/repo" && (
		cd "$tmp/repo" || exit 1
		git init -q .
		printf 'OPENAI_API_KEY=%s\n' "sk-""proj-$x20" > openai.txt
		printf 'k = "%s"\n' "sk-""ant-$x20" > anthropic.txt
		printf '%s\n' "AKIA$u16" > aws.txt
		printf '%s\n' "ASIA$u16" > aws_session.txt
		printf '%s\n' "GOCSPX-""abcdefghijklmnopqrstuvwxyz12" > google_oauth.txt
		printf '%s\n' "github_pat_""$(printf 'a%.0s' $(seq 1 64))" > github_pat.txt
		printf '%s\n' "ghp_""abcdefghijklmnopqrstuvwxyz0123456789" > github_token.txt
		printf '%s\n' "SB-Mid-""server-abcdefghijklmnop" > midtrans.txt
		printf '%s\n' "AIza""SyabcdefghijklmnopqrstuvwxyzABCDEFG" > google_api.txt
		printf '%s\n' "xoxb-""1234567890-abcdef" > slack.txt
		printf '%s\n' "-----BEGIN ""PRIVATE KEY-----" > key.pem
		printf 'url: %s\n' "https://admin:""hunter2@db.example.com/app" > config.yaml
		mkdir -p docs
		printf 'prod: %s\n' "postgres://shop:""S3cr3tPass@db.prod.internal:5432/shop" > docs/deploy.md
		printf 'X=1\n' > .env
		printf 'export X=1\n' > .envrc
		mkdir -p sub && printf 'X=1\n' > sub/.env.production
		# Allowed: not reported.
		printf 'see the task-runner-configuration-guide page\n' > false_positive.md
		printf 'DATABASE_URL=%s\n' "postgres://user:""pass@localhost/db" > .env.example
		printf 'x: %s\n' "postgres://user:""pass@localhost/db" > docker-compose.yml
		printf 'see %s\n' "postgres://user:""pass@host/db" > docs/guide.md
		printf 'DSN=%s\n' "postgres://goshop:""goshop@localhost:5432/goshop" > Makefile
		printf 'use %s\n' "https://USER:""PASSWORD@host" > README.md
		git add -A >/dev/null
		printf '%s\n' "sk-""$x20" > untracked_new.txt # new, not yet added
	)

	out=$(cd "$tmp/repo" && "$script_path")
	rc=$?
	[ $rc -eq 1 ] || fail "repo: expected exit 1, got $rc"
	for want in openai.txt:1 anthropic.txt:1 aws.txt:1 aws_session.txt:1 google_oauth.txt:1 \
		github_pat.txt:1 github_token.txt:1 midtrans.txt:1 google_api.txt:1 slack.txt:1 \
		key.pem:1 config.yaml:1 docs/deploy.md:1 untracked_new.txt:1 \
		'  .env' '  .envrc' '  sub/.env.production'; do
		if grep -qF -- "$want" <<<"$out"; then caught=$((caught + 1)); else fail "repo: not caught: $want"; fi
	done
	for deny in false_positive.md .env.example docker-compose.yml docs/guide.md Makefile README.md; do
		if grep -qF -- "$deny" <<<"$out"; then fail "repo: wrongly reported: $deny"; else allowed=$((allowed + 1)); fi
	done
	no_leaks repo

	# 2. Run from a subdirectory: files at the root must still be scanned.
	out=$(cd "$tmp/repo/sub" && "$script_path")
	rc=$?
	[ $rc -eq 1 ] || fail "subdirectory: expected exit 1, got $rc"
	grep -qF -- 'openai.txt:1' <<<"$out" || fail "subdirectory: root file not scanned"

	# 3. A repository with a single file: grep must still print the file name,
	#    never "line:match".
	mkdir -p "$tmp/one" && (
		cd "$tmp/one" || exit 1
		git init -q .
		printf 'key=%s\n' "sk-""proj-$x20" > only.txt
		git add -A >/dev/null
	)
	out=$(cd "$tmp/one" && "$script_path")
	rc=$?
	[ $rc -eq 1 ] || fail "one-file: expected exit 1, got $rc"
	grep -qF -- 'only.txt:1' <<<"$out" || fail "one-file: not caught as only.txt:1"
	no_leaks one-file

	# 4. Outside a git repository the scan must fail, not report "ok".
	mkdir -p "$tmp/nogit"
	out=$(cd "$tmp/nogit" && GIT_CEILING_DIRECTORIES="$tmp" "$script_path" 2>&1)
	rc=$?
	[ $rc -ne 0 ] || fail "outside a repository: expected a non-zero exit, got 0"

	if [ $failed -ne 0 ]; then
		echo "--- last scanner output ---"
		echo "$out"
		return 1
	fi
	echo "secret-scan self-test: ok ($caught planted samples caught, $allowed allowed cases passed;" \
		"subdirectory, one-file and outside-repository runs behave; no secret text printed)"
}

case "${1:-}" in
--self-test) self_test ;;
"") scan ;;
*) echo "usage: $0 [--self-test]" >&2; exit 2 ;;
esac
