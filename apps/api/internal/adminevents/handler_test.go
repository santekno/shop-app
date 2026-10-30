package adminevents_test

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	chimiddleware "github.com/go-chi/chi/v5/middleware"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// testSecret signs the access tokens of these tests; it is not a real key.
var testSecret = []byte("unit-test-jwt-secret-not-a-real-key-0123456789")

type noRevocations struct{}

func (noRevocations) Revoke(context.Context, ...string) error         { return nil }
func (noRevocations) IsRevoked(context.Context, string) (bool, error) { return false, nil }

// fakeSubscriber hands out fakeSubscriptions, or err.
type fakeSubscriber struct {
	mu   sync.Mutex
	subs []*fakeSubscription
	err  error
}

func (f *fakeSubscriber) Subscribe(context.Context) (adminevents.Subscription, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	s := &fakeSubscription{ch: make(chan string), closed: make(chan struct{})}
	f.subs = append(f.subs, s)
	return s, nil
}

func (f *fakeSubscriber) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.subs)
}

func (f *fakeSubscriber) last() *fakeSubscription {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.subs[len(f.subs)-1]
}

// fakeSubscription delivers what the test sends on ch; closed is closed by
// Close.
type fakeSubscription struct {
	ch     chan string
	closed chan struct{}
	once   sync.Once
}

func (s *fakeSubscription) Messages() <-chan string { return s.ch }
func (s *fakeSubscription) Close() error {
	s.once.Do(func() { close(s.closed) })
	return nil
}

// send hands payload to the stream, failing if the stream does not take it.
func (s *fakeSubscription) send(t *testing.T, payload string) {
	t.Helper()
	select {
	case s.ch <- payload:
	case <-time.After(5 * time.Second):
		t.Fatal("the stream did not read the subscription")
	}
}

func (s *fakeSubscription) waitClosed(t *testing.T) {
	t.Helper()
	select {
	case <-s.closed:
	case <-time.After(5 * time.Second):
		t.Fatal("the subscription was not closed")
	}
}

// streamEnv serves a Handler behind auth.Guard, as internal/app mounts it,
// on a real server, so streaming, flushing and deadlines are real.
type streamEnv struct {
	h      *adminevents.Handler
	sub    *fakeSubscriber
	srv    *httptest.Server
	tokens *auth.AccessTokens
	logs   *syncBuffer
	// finished receives once per request, after Stream has returned and
	// every deferred release has run.
	finished chan struct{}
}

func newStreamEnv(t *testing.T, now func() time.Time, heartbeat time.Duration) *streamEnv {
	t.Helper()
	return newStreamEnvOn(t, now, heartbeat, func(*http.Server) {})
}

// newStreamEnvOn is newStreamEnv with the real server's settings changed
// by configure before it starts (its timeouts, say).
func newStreamEnvOn(t *testing.T, now func() time.Time, heartbeat time.Duration, configure func(*http.Server)) *streamEnv {
	t.Helper()
	env := &streamEnv{
		sub: &fakeSubscriber{}, tokens: auth.NewAccessTokens(testSecret, 15*time.Minute, nil),
		logs: &syncBuffer{}, finished: make(chan struct{}, 64),
	}
	env.h = adminevents.NewHandler(env.sub, now).WithHeartbeat(heartbeat)
	logger := logx.New(logx.WithOutput(env.logs), logx.WithFormat("json"))
	r := chi.NewRouter()
	r.Use(chimiddleware.GetHead) // as httpserver.NewRouter does
	r.With(auth.NewGuard(env.tokens, noRevocations{}).Authenticate).
		Get("/v1/admin/events", func(w http.ResponseWriter, r *http.Request) {
			env.h.Stream(w, r.WithContext(logx.WithContextLogger(r.Context(), logger)))
			env.finished <- struct{}{}
		})
	env.srv = httptest.NewUnstartedServer(r)
	configure(env.srv.Config)
	env.srv.Start()
	t.Cleanup(env.srv.Close)
	return env
}

// token is a bearer token of userID; claims has its expiry.
func (env *streamEnv) token(t *testing.T, userID string) (string, auth.AccessClaims) {
	t.Helper()
	tok, claims, err := env.tokens.Issue(user.User{ID: userID, Role: user.RoleSeller}, "s1")
	testx.AssertNoError(t, err)
	return "Bearer " + tok, claims
}

// stream is one open event stream as a client reads it.
type stream struct {
	resp   *http.Response
	r      *bufio.Reader
	cancel context.CancelFunc
}

// open sends GET /v1/admin/events with authorization and returns the
// response; the body is closed when the test ends.
func (env *streamEnv) open(t *testing.T, method, authorization string) *stream {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, method, env.srv.URL+"/v1/admin/events", nil)
	testx.AssertNoError(t, err)
	if authorization != "" {
		req.Header.Set("Authorization", authorization)
	}
	resp, err := env.srv.Client().Do(req)
	if err != nil {
		cancel()
		t.Fatalf("%s /v1/admin/events: %v", method, err)
	}
	t.Cleanup(func() {
		cancel()
		_ = resp.Body.Close()
	})
	return &stream{resp: resp, r: bufio.NewReader(resp.Body), cancel: cancel}
}

// openStream opens a stream for userID and reads its first frame.
func (env *streamEnv) openStream(t *testing.T, userID string) *stream {
	t.Helper()
	bearer, _ := env.token(t, userID)
	s := env.open(t, http.MethodGet, bearer)
	testx.AssertEqual(t, s.resp.StatusCode, http.StatusOK)
	testx.AssertEqual(t, s.frame(t), ": connected\n\n")
	return s
}

// frame reads up to and including the next blank line; io.EOF when the
// stream has ended.
func (s *stream) frame(t *testing.T) string {
	t.Helper()
	type result struct {
		frame string
		err   error
	}
	done := make(chan result, 1)
	go func() {
		var b strings.Builder
		for {
			line, err := s.r.ReadString('\n')
			b.WriteString(line)
			if err != nil {
				done <- result{b.String(), err}
				return
			}
			if line == "\n" {
				done <- result{b.String(), nil}
				return
			}
		}
	}()
	select {
	case res := <-done:
		if res.err != nil {
			return "EOF:" + res.frame
		}
		return res.frame
	case <-time.After(5 * time.Second):
		t.Fatal("no frame from the stream")
		return ""
	}
}

// waitFinished waits until n more requests have returned from Stream.
func (env *streamEnv) waitFinished(t *testing.T, n int) {
	t.Helper()
	for range n {
		select {
		case <-env.finished:
		case <-time.After(5 * time.Second):
			t.Fatal("Stream did not return")
		}
	}
}

// syncBuffer is a bytes.Buffer safe to read while the server logs to it.
type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	n, _ := b.buf.Write(p) // bytes.Buffer.Write never fails
	return n, nil
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

const (
	userA = "0190c8a0-0000-7000-8000-00000000a001"
	userB = "0190c8a0-0000-7000-8000-00000000b001"
	// noBeat keeps heartbeats out of a test that does not want them.
	noBeat = time.Hour
)

func TestStream_HeadersAndMessages(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	s := env.openStream(t, userA)

	testx.AssertEqual(t, s.resp.Header.Get("Content-Type"), "text/event-stream")
	testx.AssertEqual(t, s.resp.Header.Get("X-Accel-Buffering"), "no")
	testx.AssertEqual(t, env.sub.count(), 1, "one subscription per stream")

	sub := env.sub.last()
	sub.send(t, `{"id":"e1","event":"order","data":{"type":"order.paid", "code": "GS-1"}}`)
	testx.AssertEqual(t, s.frame(t), "id: e1\nevent: order\ndata: {\"type\":\"order.paid\",\"code\":\"GS-1\"}\n\n")
	// Data spread over lines is compacted to one data line.
	sub.send(t, "{\"id\":\"e2\",\"event\":\"order\",\"data\":{\n  \"a\": [1,\n 2]\n}}")
	testx.AssertEqual(t, s.frame(t), "id: e2\nevent: order\ndata: {\"a\":[1,2]}\n\n")
}

// A message that would break the SSE framing is logged and skipped; the
// stream goes on.
func TestStream_SkipsBrokenMessages(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	s := env.openStream(t, userA)
	sub := env.sub.last()

	broken := []string{
		`not json`,
		`{"id":"","event":"order","data":{}}`,
		`{"id":"e1","event":"","data":{}}`,
		`{"id":"e1\ndata: {\"forged\":true}","event":"order","data":{}}`,
		`{"id":"e1","event":"order\r","data":{}}`,
		`{"id":"e1","event":"order"}`,
	}
	for _, payload := range broken {
		sub.send(t, payload)
	}
	sub.send(t, `{"id":"e9","event":"order","data":{"ok":true}}`)
	testx.AssertEqual(t, s.frame(t), "id: e9\nevent: order\ndata: {\"ok\":true}\n\n", "only the good message is written")
	testx.AssertEqual(t, strings.Count(env.logs.String(), `"msg":"admin feed: message skipped"`), len(broken), "logs: %s", env.logs.String())
}

// An idle stream sends a comment line every heartbeat.
func TestStream_Heartbeat(t *testing.T) {
	env := newStreamEnv(t, time.Now, time.Millisecond)
	s := env.openStream(t, userA)
	testx.AssertEqual(t, s.frame(t), ": ping\n\n")
	testx.AssertEqual(t, s.frame(t), ": ping\n\n", "and again")
}

// A stream outlives the server's ReadTimeout and WriteTimeout (internal/
// app sets both, far shorter than a stream lives): the handler lifts the
// read deadline and moves the write deadline on every write. With both
// at 200 ms and a heartbeat of 500 ms, two pings arrive about a second
// in, long after either timeout would have ended the stream.
func TestStream_OutlivesTheServersTimeouts(t *testing.T) {
	env := newStreamEnvOn(t, time.Now, 500*time.Millisecond, func(srv *http.Server) {
		srv.ReadTimeout = 200 * time.Millisecond
		srv.WriteTimeout = 200 * time.Millisecond
	})
	started := time.Now()
	s := env.openStream(t, userA)

	testx.AssertEqual(t, s.frame(t), ": ping\n\n")
	testx.AssertEqual(t, s.frame(t), ": ping\n\n", "and again")
	testx.AssertTrue(t, time.Since(started) >= time.Second, "two heartbeats in: %s", time.Since(started))
	// And it still carries events.
	env.sub.last().send(t, `{"id":"e1","event":"order","data":{}}`)
	testx.AssertEqual(t, s.frame(t), "id: e1\nevent: order\ndata: {}\n\n")
}

// The stream ends with an end event when the caller's access token
// expires, by the handler's clock.
func TestStream_EndsWhenTheTokenExpires(t *testing.T) {
	var expiresAt time.Time
	var mu sync.Mutex
	now := func() time.Time {
		mu.Lock()
		defer mu.Unlock()
		return expiresAt.Add(time.Second) // already past
	}
	env := newStreamEnv(t, now, noBeat)
	bearer, claims := env.token(t, userA)
	mu.Lock()
	expiresAt = claims.ExpiresAt
	mu.Unlock()

	s := env.open(t, http.MethodGet, bearer)
	testx.AssertEqual(t, s.frame(t), ": connected\n\n")
	testx.AssertEqual(t, s.frame(t), "event: end\ndata: {\"reason\":\"token_expired\"}\n\n")
	testx.AssertEqual(t, s.frame(t), "EOF:", "the server closes the stream")
	env.sub.last().waitClosed(t)
	env.waitFinished(t, 1)
}

// A token with time left keeps the stream open: the timer counts from the
// handler's clock to the token's expiry.
func TestStream_StaysOpenWhileTheTokenLives(t *testing.T) {
	env := newStreamEnv(t, time.Now, time.Millisecond)
	s := env.openStream(t, userA)
	for range 3 {
		testx.AssertEqual(t, s.frame(t), ": ping\n\n", "pings, not an end event")
	}
}

func TestStream_Shutdown(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	first, second := env.openStream(t, userA), env.openStream(t, userB)

	env.h.Shutdown()
	env.h.Shutdown() // twice is harmless (http.Server may call it once per server)
	for _, s := range []*stream{first, second} {
		testx.AssertEqual(t, s.frame(t), "event: end\ndata: {\"reason\":\"shutdown\"}\n\n")
		testx.AssertEqual(t, s.frame(t), "EOF:")
	}
	env.waitFinished(t, 2)

	// A stream opened after Shutdown ends at once.
	late := env.openStream(t, userA)
	testx.AssertEqual(t, late.frame(t), "event: end\ndata: {\"reason\":\"shutdown\"}\n\n")
}

// When the subscription can no longer promise every message (Redis lost),
// the stream ends without an end event; the client reconnects and
// refetches.
func TestStream_EndsWhenTheSubscriptionEnds(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	s := env.openStream(t, userA)
	close(env.sub.last().ch)

	testx.AssertEqual(t, s.frame(t), "EOF:")
	env.sub.last().waitClosed(t)
	env.waitFinished(t, 1)
}

// A client that goes away ends its stream and frees its subscription and
// its slot.
func TestStream_ClientGoesAway(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	s := env.openStream(t, userA)
	s.cancel()
	env.sub.last().waitClosed(t)
	env.waitFinished(t, 1)
}

// At most MaxStreamsPerUser streams per account; the next one is 429 until
// one closes. Other accounts have their own count.
func TestStream_TooManyStreams(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	streams := make([]*stream, 0, adminevents.MaxStreamsPerUser)
	for range adminevents.MaxStreamsPerUser {
		streams = append(streams, env.openStream(t, userA))
	}

	bearer, _ := env.token(t, userA)
	refused := env.open(t, http.MethodGet, bearer)
	testx.AssertEqual(t, refused.resp.StatusCode, http.StatusTooManyRequests)
	testx.AssertContains(t, refused.resp.Header.Get("Content-Type"), "application/json")
	var body struct {
		Error struct {
			Code    string         `json:"code"`
			Message string         `json:"message"`
			Details map[string]any `json:"details"`
		} `json:"error"`
	}
	testx.AssertNoError(t, json.NewDecoder(refused.resp.Body).Decode(&body))
	testx.AssertEqual(t, body.Error.Code, adminevents.CodeTooManyStreams)
	testx.AssertEqual(t, body.Error.Message, "too many open event streams for this account; close one first")
	testx.AssertEqual(t, body.Error.Details["max"], any(float64(adminevents.MaxStreamsPerUser)))
	env.waitFinished(t, 1)
	testx.AssertEqual(t, env.sub.count(), adminevents.MaxStreamsPerUser, "a refused stream does not subscribe")

	env.openStream(t, userB) // another account is not affected

	streams[0].cancel()
	env.waitFinished(t, 1)
	env.openStream(t, userA) // the freed slot is usable again
}

// HEAD answers the stream's headers without subscribing, and frees its
// slot.
func TestStream_Head(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	bearer, _ := env.token(t, userA)
	for range adminevents.MaxStreamsPerUser + 1 {
		s := env.open(t, http.MethodHead, bearer)
		testx.AssertEqual(t, s.resp.StatusCode, http.StatusOK)
		testx.AssertEqual(t, s.resp.Header.Get("Content-Type"), "text/event-stream")
		testx.AssertEqual(t, s.resp.Header.Get("X-Accel-Buffering"), "no")
		env.waitFinished(t, 1)
	}
	testx.AssertEqual(t, env.sub.count(), 0)
}

// A failed subscription is a JSON error, not an event stream, and frees
// its slot.
func TestStream_SubscribeFails(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	env.sub.err = errors.New("redis: connection refused")
	bearer, _ := env.token(t, userA)
	for range adminevents.MaxStreamsPerUser + 1 {
		s := env.open(t, http.MethodGet, bearer)
		testx.AssertEqual(t, s.resp.StatusCode, http.StatusInternalServerError)
		testx.AssertContains(t, s.resp.Header.Get("Content-Type"), "application/json")
		b, err := io.ReadAll(s.resp.Body)
		testx.AssertNoError(t, err)
		testx.AssertContains(t, string(b), `"code":"INTERNAL_ERROR"`)
		testx.AssertFalse(t, strings.Contains(string(b), "connection refused"), "the cause does not leak")
		env.waitFinished(t, 1)
	}
}

// The guard runs first: no token, no stream and no slot.
func TestStream_NeedsAToken(t *testing.T) {
	env := newStreamEnv(t, time.Now, noBeat)
	s := env.open(t, http.MethodGet, "")
	testx.AssertEqual(t, s.resp.StatusCode, http.StatusUnauthorized)
	testx.AssertEqual(t, env.sub.count(), 0)
}
