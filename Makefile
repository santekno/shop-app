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

# Pinned so every chapter lints the contract with the same rules.
REDOCLY := REDOCLY_TELEMETRY=off REDOCLY_SUPPRESS_UPDATE_NOTICE=true npx --yes @redocly/cli@2.66.1

# Where integration tests find the Compose dependencies. testx reads
# POSTGRES_DSN and REDIS_ADDR and skips the test when they are unset.
IT_ENV := POSTGRES_DSN='postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable' \
	REDIS_ADDR=localhost:6379 \
	S3_ENDPOINT=http://localhost:8333

.PHONY: help doctor build lint lint-openapi test-unit test-integration test-mobile-e2e docker-build scan verify up down

help: ## List targets
	@grep -E '^[a-z0-9-]+:.*## ' $(MAKEFILE_LIST) | awk -F':.*## ' '{printf "  %-18s %s\n", $$1, $$2}'

doctor: ## Check that the required tools are installed
	./scripts/check-tools.sh

build: ## Compile and type-check every app present
ifneq ($(HAS_API),)
	cd $(API) && go build ./...
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run typecheck
	pnpm -r --if-present run build
endif
	@echo "build: ok"

lint: lint-openapi ## Lint every app present and the API contract
ifneq ($(HAS_API),)
	cd $(API) && go vet ./... && golangci-lint run ./...
endif
ifneq ($(HAS_PNPM),)
	pnpm -r --if-present run lint
endif
	@echo "lint: ok"

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

test-integration: ## Integration and e2e tests against the Compose deps; fails on any skipped test
	./scripts/no-skips.sh --self-test
ifneq ($(HAS_API),)
	$(COMPOSE) up -d --wait postgres redis storage
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

docker-build: ## Build every service image the compose file defines
	$(COMPOSE) build
	@echo "docker-build: ok"

scan: ## Fail on secrets or .env files in tracked and new files (self-test first)
	./scripts/secret-scan.sh --self-test
	./scripts/secret-scan.sh

verify: build lint docker-build test-unit test-integration scan ## The full verified gate
	@echo "verify: all stages passed"

up: ## Start the full stack locally
	$(COMPOSE) up -d --build

down: ## Stop the local stack
	$(COMPOSE) down
