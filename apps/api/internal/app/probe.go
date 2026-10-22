package app

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"
)

// probeTimeout bounds `api healthcheck`, well inside Docker's own timeout.
const probeTimeout = 3 * time.Second

// Probe asks the API running on port of this machine for /healthz and
// returns nil on 200. It backs `api healthcheck`, the Docker health check:
// the distroless runtime image has no shell, curl or wget, so the binary
// checks itself.
func Probe(ctx context.Context, port int) error {
	ctx, cancel := context.WithTimeout(ctx, probeTimeout)
	defer cancel()

	url := "http://127.0.0.1:" + strconv.Itoa(port) + "/healthz"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("healthcheck: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("healthcheck: %s answered %d", url, resp.StatusCode)
	}
	return nil
}
