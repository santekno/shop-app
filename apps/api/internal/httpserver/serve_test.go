package httpserver_test

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
)

func listen(t *testing.T) net.Listener {
	t.Helper()
	var lc net.ListenConfig
	ln, err := lc.Listen(context.Background(), "tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	return ln
}

func get(ctx context.Context, url string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, fmt.Errorf("new request: %w", err)
	}
	client := &http.Client{Transport: &http.Transport{DisableKeepAlives: true}}
	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("get %s: %w", url, err)
	}
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}

type result struct {
	err     error
	elapsed time.Duration // from ctx cancel to Serve returning
}

// startServe runs Serve in the background and returns a function that
// cancels its context and waits for it to return.
func startServe(t *testing.T, h http.Handler, opts httpserver.ShutdownOptions) (string, func() result) {
	t.Helper()
	ln := listen(t)
	srv := httpserver.New(ln.Addr().String(), h, time.Second)
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- httpserver.Serve(ctx, srv, ln, opts) }()
	stop := func() result {
		start := time.Now()
		cancel()
		select {
		case err := <-done:
			return result{err: err, elapsed: time.Since(start)}
		case <-time.After(10 * time.Second):
			t.Fatal("Serve did not return")
			return result{}
		}
	}
	t.Cleanup(cancel)
	return "http://" + ln.Addr().String(), stop
}

func TestServe_CleanShutdown(t *testing.T) {
	var logs bytes.Buffer
	url, stop := startServe(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), httpserver.ShutdownOptions{Timeout: time.Second, Logger: logging.New(&logs, false, "info")})

	code, err := get(context.Background(), url)
	if err != nil {
		t.Fatalf("GET while serving: %v", err)
	}
	testx.AssertEqual(t, code, http.StatusOK)

	res := stop()
	testx.AssertNoError(t, res.err, "a clean stop returns nil (OnDrain nil, no drain delay)")
	_, err = get(context.Background(), url)
	testx.AssertError(t, err, "listener is closed after Serve returns")
	testx.AssertContains(t, logs.String(), `"msg":"shutdown started"`)
	testx.AssertContains(t, logs.String(), `"msg":"shutdown complete"`)
}

func TestServe_DrainsBeforeShutdown(t *testing.T) {
	const drainDelay = 300 * time.Millisecond
	var drained atomic.Bool
	duringDrain := make(chan int, 1)

	var url string
	url, stop := startServe(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}), httpserver.ShutdownOptions{
		OnDrain: func() {
			drained.Store(true)
			// While the drain delay runs, the server must still answer.
			go func() {
				code, err := get(context.Background(), url)
				if err != nil {
					code = -1
				}
				duringDrain <- code
			}()
		},
		DrainDelay: drainDelay,
		Timeout:    time.Second,
		Logger:     logx.Noop(),
	})
	testx.AssertFalse(t, drained.Load(), "OnDrain must not run before shutdown")

	res := stop()

	testx.AssertNoError(t, res.err)
	testx.AssertTrue(t, drained.Load(), "OnDrain ran")
	testx.AssertTrue(t, res.elapsed >= drainDelay, "Serve returned after %s, before the %s drain delay", res.elapsed, drainDelay)
	select {
	case code := <-duringDrain:
		testx.AssertEqual(t, code, http.StatusOK, "request during the drain delay is served")
	case <-time.After(5 * time.Second):
		t.Fatal("request during drain never finished")
	}
}

func TestServe_WaitsForInFlightRequests(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	url, stop := startServe(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusAccepted)
	}), httpserver.ShutdownOptions{Timeout: 5 * time.Second, Logger: logx.Noop()})

	inFlight := make(chan int, 1)
	go func() {
		code, err := get(context.Background(), url)
		if err != nil {
			code = -1
		}
		inFlight <- code
	}()
	<-started

	stopped := make(chan result, 1)
	go func() { stopped <- stop() }()
	time.Sleep(50 * time.Millisecond)
	close(release)

	res := <-stopped
	testx.AssertNoError(t, res.err)
	testx.AssertEqual(t, <-inFlight, http.StatusAccepted, "in-flight request finished during shutdown")
}

func TestServe_ShutdownTimeoutCloses(t *testing.T) {
	started := make(chan struct{})
	release := make(chan struct{})
	t.Cleanup(func() { close(release) })
	url, stop := startServe(t, http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		close(started)
		<-release
		w.WriteHeader(http.StatusOK)
	}), httpserver.ShutdownOptions{Timeout: 50 * time.Millisecond, Logger: logx.Noop()})

	inFlight := make(chan error, 1)
	go func() {
		_, err := get(context.Background(), url)
		inFlight <- err
	}()
	<-started

	res := stop()

	if res.err == nil {
		t.Fatal("Serve: want shutdown error, got nil")
	}
	testx.AssertContains(t, res.err.Error(), "shutdown: ")
	testx.AssertTrue(t, errors.Is(res.err, context.DeadlineExceeded), "err = %v", res.err)
	testx.AssertTrue(t, res.elapsed < 2*time.Second, "Serve waited %s, past its 50ms timeout", res.elapsed)
	select {
	case err := <-inFlight:
		// Close cut the connection instead of letting the request finish.
		testx.AssertError(t, err, "the stuck request's connection is closed")
	case <-time.After(5 * time.Second):
		t.Fatal("stuck request was not cut off by Close")
	}
}

func TestServe_ServerErrorBeforeShutdown(t *testing.T) {
	ln := listen(t)
	_ = ln.Close() // Serve on a closed listener fails at once
	srv := httpserver.New(ln.Addr().String(), http.NotFoundHandler(), time.Second)
	drained := false

	err := httpserver.Serve(context.Background(), srv, ln, httpserver.ShutdownOptions{
		OnDrain: func() { drained = true },
		Timeout: time.Second,
		Logger:  logx.Noop(),
	})

	if err == nil {
		t.Fatal("Serve: want error, got nil")
	}
	testx.AssertContains(t, err.Error(), "serve: ")
	testx.AssertTrue(t, errors.Is(err, net.ErrClosed), "err = %v", err)
	testx.AssertFalse(t, drained, "no graceful shutdown when serving failed")
}
