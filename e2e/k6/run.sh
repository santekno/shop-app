#!/usr/bin/env bash
# make loadtest: the k6 checkout load test (e2e/k6/checkout.js) against the
# Compose stack, then the oversell check in SQL (e2e/k6/verify.sql).
#
# Needs `APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up`, `make seed` and
# `SEED_LOADTEST_PASSWORD=… make seed-loadtest users=20` first, and the same
# SEED_LOADTEST_PASSWORD in the environment. Uses a local k6 when there is
# one, otherwise the grafana/k6 image, which joins the api container's
# network namespace so http://localhost:8080 is the API (no volume mounts:
# the script is read from stdin). Every variable of checkout.js
# (PLENTY_VUS, SCARCE_VUS, SCARCE_ATTEMPTS, DURATION) can be set as well.
set -euo pipefail

cd "$(dirname "$0")/../.."
COMPOSE=${COMPOSE:-docker-compose}
K6_IMAGE=${K6_IMAGE:-grafana/k6:2.3.0}

if [ -z "${SEED_LOADTEST_PASSWORD:-}" ]; then
	echo "loadtest: set SEED_LOADTEST_PASSWORD (the password make seed-loadtest used)" >&2
	exit 1
fi
api=$($COMPOSE ps -q api)
if [ -z "$api" ]; then
	echo "loadtest: the api service is not running; start the stack with APP_CHECKOUT_LIMIT_PER_MINUTE=100000 make up" >&2
	exit 1
fi

# Each VU checks out about 1,200 times a minute, against a per-buyer limit
# of APP_CHECKOUT_LIMIT_PER_MINUTE (30 by default): read the running api's
# value and refuse a run that would measure 429s.
need=100000
limit=$(docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$api" |
	sed -n 's/^APP_CHECKOUT_LIMIT_PER_MINUTE=//p')
limit=${limit:-30}
case $limit in *[!0-9]*) limit=0 ;; esac
if [ "$limit" -lt "$need" ]; then
	echo "loadtest: the api runs with APP_CHECKOUT_LIMIT_PER_MINUTE=$limit, and the load test needs $need." >&2
	echo "loadtest: restart it with: APP_CHECKOUT_LIMIT_PER_MINUTE=$need make up" >&2
	exit 1
fi

# Every buyer logs in once, and login is limited to 20 per IP per 15
# minutes: clear the local rate-limit counters so a second run in a row
# can log in too. Local Compose Redis only.
$COMPOSE exec -T redis redis-cli EVAL \
	"local n = 0 for _, k in ipairs(redis.call('KEYS', ARGV[1])) do n = n + redis.call('DEL', k) end return n" \
	0 'goshop:rl:*' >/dev/null

vars=()
for v in SEED_LOADTEST_PASSWORD PLENTY_VUS SCARCE_VUS SCARCE_ATTEMPTS DURATION; do
	if [ -n "${!v:-}" ]; then
		vars+=(-e "$v=${!v}")
	fi
done

status=0
if command -v k6 >/dev/null 2>&1; then
	k6 run ${vars[@]+"${vars[@]}"} -e API_URL=http://localhost:8080 e2e/k6/checkout.js || status=$?
else
	docker run --rm -i --network "container:$api" ${vars[@]+"${vars[@]}"} -e API_URL=http://localhost:8080 \
		"$K6_IMAGE" run - <e2e/k6/checkout.js || status=$?
fi

echo "loadtest: checking the database for oversold stock"
$COMPOSE exec -T postgres psql -U goshop -d goshop -v ON_ERROR_STOP=1 -q <e2e/k6/verify.sql
if [ "$status" -ne 0 ]; then
	echo "loadtest: k6 exited with $status (a threshold failed)" >&2
	exit "$status"
fi
echo "loadtest: ok"
