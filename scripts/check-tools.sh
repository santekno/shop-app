#!/usr/bin/env bash
# Check that the tools GoShop needs are installed and new enough. Prints one
# line per tool and exits 1 when a required tool is missing or too old.
#
# usage: scripts/check-tools.sh   (or: make doctor)
set -uo pipefail

failed=0

ok()       { printf '  %-15s ok        %s\n' "$1" "$2"; }
missing()  { printf '  %-15s MISSING   %s\n' "$1" "$2"; failed=1; }
optional() { printf '  %-15s optional  %s\n' "$1" "$2"; }

has() { command -v "$1" >/dev/null 2>&1; }

# version_ge A B succeeds when dotted version A >= B (e.g. 1.26.1 >= 1.26).
version_ge() {
	awk -v a="$1" -v b="$2" 'BEGIN {
		na = split(a, x, "."); nb = split(b, y, ".")
		n = na > nb ? na : nb
		for (i = 1; i <= n; i++) {
			if (x[i] + 0 > y[i] + 0) exit 0
			if (x[i] + 0 < y[i] + 0) exit 1
		}
		exit 0
	}'
}

# first_version prints the first x.y[.z] found in its input.
first_version() { grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1; }

echo "GoShop tool check"

if has git; then
	ok git "$(git --version | first_version)"
else
	missing git "install git"
fi

# Go 1.21+ can download a newer toolchain by itself when a go.mod asks for one
# (GOTOOLCHAIN=auto, the default), so an older Go is fine unless that is off.
if has go; then
	gov=$(go env GOVERSION | first_version)
	gotc=$(go env GOTOOLCHAIN)
	if version_ge "$gov" 1.26; then
		ok go "$gov"
	elif version_ge "$gov" 1.21 && [[ $gotc == *auto* ]]; then
		ok go "$gov (GOTOOLCHAIN=$gotc fetches go1.26+ on the first build of apps/api)"
	else
		missing go "found $gov with GOTOOLCHAIN=$gotc; install go >= 1.26 or set GOTOOLCHAIN=auto"
	fi
else
	missing go "install go >= 1.26 (see docs/setup.md)"
fi

if has node; then
	nodev=$(node --version | first_version)
	if version_ge "$nodev" 22.12; then
		ok node "$nodev"
	else
		missing node "found $nodev; need >= 22.12, 24 recommended (nvm install, reads .nvmrc)"
	fi
else
	missing node "install node 24 LTS (nvm install, reads .nvmrc)"
fi

if has pnpm; then
	pnpmv=$(pnpm --version | first_version)
	if version_ge "$pnpmv" 10; then
		ok pnpm "$pnpmv"
	else
		missing pnpm "found $pnpmv; need >= 10 (corepack enable pnpm)"
	fi
else
	missing pnpm "run: corepack enable pnpm"
fi

if has docker; then
	if docker info >/dev/null 2>&1; then
		ok docker "$(docker version --format '{{.Server.Version}}' 2>/dev/null)"
	else
		missing docker "installed, but the daemon is not running (start Docker Desktop or colima)"
	fi
else
	missing docker "install Docker Desktop, Docker Engine or colima"
fi

# The Makefile accepts either the compose plugin or the standalone binary.
if docker compose version >/dev/null 2>&1; then
	ok compose "$(docker compose version --short | first_version) (docker compose)"
elif has docker-compose; then
	composev=$(docker-compose version --short | first_version)
	if version_ge "$composev" 2; then
		ok compose "$composev (docker-compose)"
	else
		missing compose "found docker-compose $composev; need Compose v2"
	fi
else
	missing compose "install the Docker Compose v2 plugin or docker-compose"
fi

# Not needed until apps/api exists (Bab 2), so it never fails the check.
if has golangci-lint; then
	optional golangci-lint "$(golangci-lint --version | first_version) (used by make lint from Bab 2)"
else
	optional golangci-lint "not installed; needed by make lint from Bab 2 (see docs/setup.md)"
fi

if [ $failed -ne 0 ]; then
	echo "doctor: some required tools are missing, see docs/setup.md"
	exit 1
fi
echo "doctor: ok"
