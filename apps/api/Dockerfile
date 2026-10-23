# syntax=docker/dockerfile:1
# GoShop API image. The build context is the repository root, the same way
# Railway builds it:
#
#   docker build -f apps/api/Dockerfile -t goshop-api .
#
# No secret is baked in: every setting comes from env vars at run time.

# --- build: compile a static binary -------------------------------------
# Same patch release as the toolchain line in apps/api/go.mod.
FROM golang:1.26.10-alpine AS build
WORKDIR /src/apps/api

# Dependencies first, so this layer is reused until go.mod or go.sum change.
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download

COPY apps/api/ ./
# CGO off: a static binary that runs on an image with no C library.
# -trimpath drops local paths from the binary; -s -w strips debug symbols.
# One package at a time (-p=1) and a tighter compiler GC (GOGC=50): with
# parallel compiles, go-redis (Bab 4) alone ran a 2 GiB Docker VM out of
# memory. The build gets a little slower; the image is the same.
RUN GOFLAGS=-p=1 GOGC=50 CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api

# --- runtime: just the binary --------------------------------------------
# distroless/static has no shell or package manager, only CA certificates,
# time zones and a non-root user, so there is little to attack or patch.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/api /api
USER nonroot:nonroot
# The API listens on $PORT when set (Railway), otherwise $APP_PORT or 8080.
EXPOSE 8080
# No curl or wget in this image: the binary probes itself.
HEALTHCHECK --interval=10s --timeout=5s --start-period=5s --retries=3 CMD ["/api", "healthcheck"]
ENTRYPOINT ["/api"]
