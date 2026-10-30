package adminevents

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// Stream limits.
const (
	// Heartbeat is how often an idle stream sends a comment line, so
	// proxies that close quiet connections (often after 30 to 60 seconds)
	// leave it open, and a dead client is noticed by the failed write.
	Heartbeat = 25 * time.Second
	// WriteTimeout bounds each write to the stream: a client that stops
	// reading loses its stream instead of holding it. Each write moves the
	// deadline to one heartbeat plus WriteTimeout ahead, so it never
	// passes between two writes (a deadline that has passed cannot always
	// be extended; see http.ResponseController.SetWriteDeadline).
	WriteTimeout = 10 * time.Second
	// MaxStreamsPerUser is how many streams one account may hold open on
	// one API instance: enough for a few tabs, and a client that leaks
	// streams on every reconnect hits a 429 instead of a Redis connection
	// per leak.
	MaxStreamsPerUser = 5
)

// CodeTooManyStreams is the 429 code of a stream over MaxStreamsPerUser.
const CodeTooManyStreams = "TOO_MANY_STREAMS"

// Why a stream ended, in its last "end" event.
const (
	EndTokenExpired = "token_expired"
	EndShutdown     = "shutdown"
)

// Handler serves GET /v1/admin/events.
type Handler struct {
	sub       Subscriber
	now       func() time.Time
	heartbeat time.Duration

	mu   sync.Mutex
	open map[string]int // streams per user ID

	shutdown     chan struct{}
	shutdownOnce sync.Once
}

// NewHandler returns a Handler whose streams subscribe through sub and
// end when the caller's access token expires by now.
func NewHandler(sub Subscriber, now func() time.Time) *Handler {
	return &Handler{
		sub: sub, now: now, heartbeat: Heartbeat,
		open: map[string]int{}, shutdown: make(chan struct{}),
	}
}

// WithHeartbeat replaces Heartbeat, for tests; it returns h.
func (h *Handler) WithHeartbeat(d time.Duration) *Handler {
	h.heartbeat = d
	return h
}

// Shutdown ends every open stream, and every stream opened after it, with
// an "end" event (EndShutdown). The server calls it when it starts
// shutting down (http.Server.RegisterOnShutdown): a stream never ends on
// its own, and the graceful shutdown would otherwise wait for it until
// APP_SHUTDOWN_TIMEOUT and then cut it off.
func (h *Handler) Shutdown() {
	h.shutdownOnce.Do(func() { close(h.shutdown) })
}

// Stream serves GET /v1/admin/events: 200 with a text/event-stream that
// stays open until the caller's access token expires, the client goes
// away, or the server shuts down. It must be mounted behind
// auth.Guard.Authenticate and outside the request timeout (see
// httpserver.Options.Streams).
func (h *Handler) Stream(w http.ResponseWriter, r *http.Request) {
	claims, ok := auth.ClaimsFrom(r.Context())
	if !ok {
		// Mounted without the guard: fail closed.
		httpapi.Error(w, r, httpapi.UnauthorizedError("missing access token"))
		return
	}
	if !h.acquire(claims.UserID) {
		httpapi.Error(w, r, errx.New(CodeTooManyStreams, "too many open event streams for this account; close one first").
			WithHTTPStatus(http.StatusTooManyRequests).
			WithDetails(map[string]any{"max": MaxStreamsPerUser}))
		return
	}
	defer h.release(claims.UserID)

	header := w.Header()
	header.Set("Content-Type", "text/event-stream")
	// nginx and similar proxies buffer responses by default, which would
	// hold events back until the buffer fills.
	header.Set("X-Accel-Buffering", "no")
	if r.Method == http.MethodHead {
		w.WriteHeader(http.StatusOK)
		return
	}

	sub, err := h.sub.Subscribe(r.Context())
	if err != nil {
		header.Del("Content-Type")
		httpapi.Error(w, r, err)
		return
	}
	defer func() { _ = sub.Close() }()

	s := &stream{w: w, rc: http.NewResponseController(w), deadline: h.heartbeat + WriteTimeout}
	// The server's WriteTimeout would cut the stream off, so every write
	// sets its own deadline instead (stream.write). Its ReadTimeout does
	// not reach the stream: for a request without a body, HTTP/1 clears
	// the read deadline before the handler runs (the background read that
	// notices a client hanging up runs without one), and HTTP/2 applies it
	// only to the request body. That is net/http's internal behaviour, not
	// its documented contract, so the stream lifts the read deadline
	// itself too; nothing reads the request after this point.
	if err := s.rc.SetReadDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		httpapi.Error(w, r, fmt.Errorf("lift the read deadline: %w", err))
		return
	}
	w.WriteHeader(http.StatusOK)
	if s.write(": connected\n\n") != nil {
		return
	}
	h.serve(r, s, sub, claims.ExpiresAt)
}

// serve writes the stream until it ends.
func (h *Handler) serve(r *http.Request, s *stream, sub Subscription, expiresAt time.Time) {
	expired := time.NewTimer(expiresAt.Sub(h.now()))
	defer expired.Stop()
	beat := time.NewTicker(h.heartbeat)
	defer beat.Stop()
	log := logx.FromContext(r.Context())

	for {
		var err error
		select {
		case <-r.Context().Done():
			return // the client went away
		case <-h.shutdown:
			_ = s.end(EndShutdown)
			return
		case <-expired.C:
			// The client reconnects with a fresh token; the role and the
			// session are checked again then.
			_ = s.end(EndTokenExpired)
			return
		case <-beat.C:
			err = s.write(": ping\n\n")
		case payload, ok := <-sub.Messages():
			if !ok {
				return // the subscription lost Redis: the client reconnects and refetches
			}
			frame, ferr := frameOf(payload)
			if ferr != nil {
				log.Error("admin feed: message skipped", "error", ferr.Error())
				continue
			}
			err = s.write(frame)
		}
		if err != nil {
			return // the connection is gone; the access log has the request
		}
	}
}

func (h *Handler) acquire(userID string) bool {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.open[userID] >= MaxStreamsPerUser {
		return false
	}
	h.open[userID]++
	return true
}

func (h *Handler) release(userID string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.open[userID]--; h.open[userID] <= 0 {
		delete(h.open, userID)
	}
}

// frameOf is the SSE frame of a message from the channel. It refuses a
// message that would break the framing: an id or event with a line break,
// or data that is not JSON. Data is compacted, so it is one line.
func frameOf(payload string) (string, error) {
	var m Message
	if err := json.Unmarshal([]byte(payload), &m); err != nil {
		return "", fmt.Errorf("decode message: %w", err)
	}
	if m.ID == "" || m.Event == "" || strings.ContainsAny(m.ID+m.Event, "\r\n") {
		return "", fmt.Errorf("message %q: id and event must be one non-empty line", m.ID)
	}
	var data bytes.Buffer
	if err := json.Compact(&data, m.Data); err != nil {
		return "", fmt.Errorf("message %s: data: %w", m.ID, err)
	}
	return "id: " + m.ID + "\nevent: " + m.Event + "\ndata: " + data.String() + "\n\n", nil
}

// stream writes to one open response.
type stream struct {
	w        io.Writer
	rc       *http.ResponseController
	deadline time.Duration // ahead of each write
}

// write sends text at once, and moves the write deadline.
func (s *stream) write(text string) error {
	err := s.rc.SetWriteDeadline(time.Now().Add(s.deadline))
	if err != nil && !errors.Is(err, http.ErrNotSupported) {
		return fmt.Errorf("set write deadline: %w", err)
	}
	if _, err := io.WriteString(s.w, text); err != nil {
		return fmt.Errorf("write event: %w", err)
	}
	if err := s.rc.Flush(); err != nil {
		return fmt.Errorf("flush event: %w", err)
	}
	return nil
}

// end sends the last event of a stream, saying why it ends.
func (s *stream) end(reason string) error {
	return s.write(`event: end` + "\ndata: " + `{"reason":"` + reason + `"}` + "\n\n")
}
