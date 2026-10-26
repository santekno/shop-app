# GoShop monorepo tasks. `make verify` runs the full verified gate locally:
# build -> lint -> docker-build -> unit tests (with coverage thresholds)
# -> integration tests -> secret scan. Each target only touches the apps
# that exist on the current chapter branch, so every bab-N branch passes
# with whatever it has built so far.

SHELL := /bin/bash
.DEFAULT_GOAL := help

API    := apps/api
COMPOSE ?= $(shell docker compose version >/dev/null 2>&1 && echo "docker compose" || echo docker-compose)

HAS_API  := $(wildcard $(API)/go.mod)
HAS_PNPM := $(wildcard pnpm-lock.yaml)

# golangci-lint refuses a module whose `go` line is newer than the Go it was
# built with, and a prebuilt binary may lag behind (go1.25 vs our go 1.26).
# make lint therefore builds this pinned version once, with the module's own
# toolchain, into apps/api/bin (gitignored).
GOLANGCI_VERSION := v2.15.0
GOLANGCI := $(CURDIR)/$(API)/bin/golangci-lint-$(GOLANGCI_VERSION)/golangci-lint

# Air (hot reload for make dev-api), pinned and built the same way.
AIR_VERSION := v1.67.4
AIR := $(CURDIR)/$(API)/bin/air-$(AIR_VERSION)/air

# golang-migrate CLI for make migrate-*, pinned to the library version in
# apps/api/go.mod (keep them equal) and built with only the postgres driver.
MIGRATE_VERSION := v4.20.1
MIGRATE := $(CURDIR)/$(API)/bin/migrate-$(MIGRATE_VERSION)/migrate

# sqlc (make sqlc), pinned and built the same way. It needs cgo (a C
# compiler) because it embeds PostgreSQL's own SQL parser; the first build
# takes about a minute.
SQLC_VERSION := v1.31.1
SQLC := $(CURDIR)/$(API)/bin/sqlc-$(SQLC_VERSION)/sqlc

# The database make migrate-* and seed talk to: the Compose
# postgres by default. A DATABASE_URL in your shell wins (.env is not read
# here, so a production URL in .env is never picked up by accident).
DATABASE_URL ?= postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable

# make seed-loadtest: how many load-test buyers.
users ?= 50

# Destructive targets refuse any database that is not on this machine. A
# host= or hostaddr= parameter is refused outright: pgx lets it override the
# host in the URL, and the local Compose URL never needs one.
define require_local_db
	@case '$(DATABASE_URL)' in \
		*[?\&]host=*|*[?\&]hostaddr=*) echo "$@: refusing a DATABASE_URL with a host or hostaddr parameter" >&2; exit 1 ;; \
		*@localhost:*|*@localhost/*|*@127.0.0.1:*|*@127.0.0.1/*) ;; \
		*) echo "$@: refusing a DATABASE_URL that is not localhost or 127.0.0.1" >&2; exit 1 ;; \
	esac
endef

# Pinned so every chapter lints the contract with the same rules.
REDOCLY := REDOCLY_TELEMETRY=off REDOCLY_SUPPRESS_UPDATE_NOTICE=true npx --yes @redocly/cli@2.66.1

# Where integration tests find the Compose services. testx reads
# POSTGRES_DSN and REDIS_ADDR and skips the test when they are unset;
# DATABASE_URL is the same database for an API started in-process with
# config.Load, which also needs REDIS_URL and JWT_SECRET (a key for tests
# only);
# GOSHOP_API_URL is the api container, which the stack test requires.
IT_ENV := POSTGRES_DSN='postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable' \
	DATABASE_URL='postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable' \
	REDIS_ADDR=localhost:6379 \
	REDIS_URL=redis://localhost:6379/0 \
	JWT_SECRET=integration-tests-only-signing-key-0123456789 \
	S3_ENDPOINT=http://localhost:8333 \
	S3_BUCKET=goshop \
	S3_ACCESS_KEY=goshop \
	S3_SECRET_KEY=goshop-secret \
	GOSHOP_API_URL=http://127.0.0.1:8080

.PHONY: help doctor build lint lint-openapi test-unit test-integration test-mobile-e2e docker-build scan verify up down dev-api docs-api \
	migrate-up migrate-down migrate-new seed seed-large seed-admin seed-loadtest loadtest sqlc sqlc-check expire-orders cleanup-idempotency-keys publish-events reconcile-payments process-images fake-pay dead-tasks requeue-task requeue-dead-tasks

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

doctor: ## Check that the required tools are installed
	./scripts/check-tools.sh

build: ## Compile and type-check every app present
ifneq ($(HAS_API),)
	cd $(API) && go build -o bin/ ./...
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run typecheck
	pnpm -r --if-present run build
endif
	@echo "build: ok"

lint: lint-openapi $(if $(HAS_API),$(GOLANGCI) sqlc-check) ## Lint every app present, the API contract and the sqlc output
ifneq ($(HAS_API),)
	cd $(API) && go vet -tags=integration ./... && $(GOLANGCI) run ./...
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run lint
endif
	@echo "lint: ok"

$(GOLANGCI):
	cd $(API) && GOBIN=$(dir $(GOLANGCI)) GOTOOLCHAIN=$$(go env GOVERSION) \
		go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@$(GOLANGCI_VERSION)

lint-openapi: ## Lint the API contract (api/openapi.yaml, rules in redocly.yaml)
	$(REDOCLY) lint api/openapi.yaml

test-unit: ## Unit tests + coverage thresholds (Go >= 80%, TS >= 70%)
ifneq ($(HAS_API),)
	./scripts/go-coverage.sh $(API) 80
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run test:unit
endif
	@echo "test-unit: ok"

test-integration: ## Integration and e2e tests against the Compose stack; fails on any skipped test
	./scripts/no-skips.sh --self-test
ifneq ($(HAS_API),)
	$(COMPOSE) up -d --wait --build postgres redis storage api worker
	cd $(API) && $(IT_ENV) ../../scripts/no-skips.sh go test -tags=integration -count=1 -json ./...
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run test:e2e
endif
	@echo "test-integration: ok"

test-mobile-e2e: ## Maestro mobile flows (from Bab 15; needs a running emulator or simulator)
ifneq ($(wildcard apps/mobile/.maestro),)
	maestro test apps/mobile/.maestro
else
	@echo "test-mobile-e2e: no Maestro flows yet (they arrive in Bab 15)"
endif

# Rendered API reference, written to a gitignored folder (dist/ is ignored).
API_DOCS := dist/api-docs/index.html

docs-api: ## Render api/openapi.yaml to static HTML in dist/api-docs/
	$(REDOCLY) build-docs api/openapi.yaml --output $(API_DOCS) --title "GoShop API"
	@echo "docs-api: open $(API_DOCS)"

docker-build: ## Build every service image the compose file defines
	$(COMPOSE) build
	@echo "docker-build: ok"

scan: ## Fail on secrets or .env files in tracked and new files (self-test first)
	./scripts/secret-scan.sh --self-test
	./scripts/secret-scan.sh

verify: build lint docker-build test-unit test-integration scan ## The full verified gate
	@echo "verify: all stages passed"

dev-api: $(AIR) ## Run the API with hot reload (Air), reading .env when present
	set -a; [ ! -f .env ] || . ./.env; set +a; \
		cd $(API) && APP_ENV=$${APP_ENV:-development} $(AIR) -c .air.toml

$(AIR):
	cd $(API) && GOBIN=$(dir $(AIR)) GOTOOLCHAIN=$$(go env GOVERSION) \
		go install github.com/air-verse/air@$(AIR_VERSION)

migrate-up: $(MIGRATE) ## Apply new migrations to DATABASE_URL (default: the Compose postgres)
	@$(MIGRATE) -path $(API)/migrations -database '$(DATABASE_URL)' up

migrate-down: $(MIGRATE) ## Roll back the newest migration (local databases only)
	$(require_local_db)
	@$(MIGRATE) -path $(API)/migrations -database '$(DATABASE_URL)' down 1

migrate-new: $(MIGRATE) ## Create an empty up/down pair: make migrate-new name=add_users
	@[[ "$(name)" =~ ^[a-z][a-z0-9_]*$$ ]] || { echo "usage: make migrate-new name=add_users (lower case, digits, _)" >&2; exit 1; }
	$(MIGRATE) create -ext sql -dir $(API)/migrations -seq -digits 6 $(name)

seed: ## Insert the example catalog (idempotent; local databases only)
	$(require_local_db)
	@cd $(API) && DATABASE_URL='$(DATABASE_URL)' go run ./cmd/seed

seed-large: ## The example catalog plus 10000 generated products, for EXPLAIN ANALYZE
	$(require_local_db)
	@cd $(API) && DATABASE_URL='$(DATABASE_URL)' go run ./cmd/seed -generated 10000

seed-admin: ## Create or promote a local admin: SEED_ADMIN_PASSWORD=… make seed-admin email=admin@goshop.local
	$(require_local_db)
	@[[ "$(email)" =~ ^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$$ ]] || { echo "usage: SEED_ADMIN_PASSWORD=… make seed-admin email=admin@goshop.local" >&2; exit 1; }
	@[ -n "$$SEED_ADMIN_PASSWORD" ] || { echo "seed-admin: set SEED_ADMIN_PASSWORD (read from the environment, never a flag)" >&2; exit 1; }
	@cd $(API) && DATABASE_URL='$(DATABASE_URL)' go run ./cmd/seed -admin '$(email)'

seed-loadtest: ## Load-test buyers and stock for the k6 checkout test: SEED_LOADTEST_PASSWORD=… make seed-loadtest users=50
	$(require_local_db)
	@[[ "$(users)" =~ ^[0-9]+$$ ]] || { echo "usage: SEED_LOADTEST_PASSWORD=… make seed-loadtest users=50" >&2; exit 1; }
	@[ -n "$$SEED_LOADTEST_PASSWORD" ] || { echo "seed-loadtest: set SEED_LOADTEST_PASSWORD (read from the environment, never a flag)" >&2; exit 1; }
	@cd $(API) && DATABASE_URL='$(DATABASE_URL)' go run ./cmd/seed -loadtest '$(users)'

loadtest: ## k6 load test of checkout against make up, then an oversell check in SQL (see e2e/k6/README.md)
	COMPOSE='$(COMPOSE)' ./e2e/k6/run.sh

sqlc: $(SQLC) ## Generate internal/db/sqlc from migrations/ and internal/db/queries/
	cd $(API) && $(SQLC) generate

sqlc-check: $(SQLC) ## Fail when internal/db/sqlc does not match the SQL (run make sqlc)
	@cd $(API) && $(SQLC) diff || { echo "sqlc-check: generated code is out of date; run make sqlc and commit the result" >&2; exit 1; }

$(SQLC):
	cd $(API) && GOBIN=$(dir $(SQLC)) GOTOOLCHAIN=$$(go env GOVERSION) \
		go install github.com/sqlc-dev/sqlc/cmd/sqlc@$(SQLC_VERSION)

$(MIGRATE):
	cd $(API) && GOBIN=$(dir $(MIGRATE)) GOTOOLCHAIN=$$(go env GOVERSION) \
		go install -tags postgres github.com/golang-migrate/migrate/v4/cmd/migrate@$(MIGRATE_VERSION)

expire-orders: ## Cancel unpaid orders past their payment deadline, once (the api image, as a Railway cron would run it)
	$(COMPOSE) run --rm --no-deps api expire-orders

cleanup-idempotency-keys: ## Delete checkout idempotency keys past their 24 hours, once
	$(COMPOSE) run --rm --no-deps api cleanup-idempotency-keys

publish-events: ## Publish the outbox's pending domain events (to the log until Bab 6), once
	$(COMPOSE) run --rm --no-deps api publish-events

reconcile-payments: ## Ask Midtrans about every open payment and apply its answer, once
	$(COMPOSE) run --rm --no-deps api reconcile-payments

process-images: ## Resize the confirmed product images into their storefront variants, once
	$(COMPOSE) run --rm --no-deps api process-images

fake-pay: ## Pay an order with the fake gateway (APP_PAYMENT_PROVIDER=fake): make fake-pay order=GS-… [status=settlement]
	@[[ "$(order)" =~ ^GS-[0-9]{8}-[0-9A-Z]{6}(-[0-9A-Z]{6})?$$ ]] || { echo "usage: make fake-pay order=GS-20261101-7KQ2M9 [status=settlement|expire|deny|...]" >&2; exit 1; }
	@[[ "$(status)" =~ ^[a-z_]*$$ ]] || { echo "fake-pay: status is a Midtrans transaction_status such as settlement" >&2; exit 1; }
	$(COMPOSE) exec api /api fake-pay '$(order)' $(if $(status),'$(status)')

dead-tasks: ## List the worker tasks that ran out of retries (the dead-letter queue)
	$(COMPOSE) run --rm --no-deps worker dead-tasks list

requeue-task: ## Run one dead task again: make requeue-task id=<task id>
	@[[ "$(id)" =~ ^[A-Za-z0-9:._-]+$$ ]] || { echo "usage: make requeue-task id=<task id from make dead-tasks>" >&2; exit 1; }
	$(COMPOSE) run --rm --no-deps worker dead-tasks requeue '$(id)'

requeue-dead-tasks: ## Run every dead task again
	$(COMPOSE) run --rm --no-deps worker dead-tasks requeue-all

up: ## Start the full stack locally
	$(COMPOSE) up -d --build

down: ## Stop the local stack
	$(COMPOSE) down
