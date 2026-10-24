package midtrans

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
)

// Test keys in the sandbox shape. Neither is real.
const (
	testServerKey = "SB-Mid-server-unit-test1"
	testClientKey = "SB-Mid-client-unit-test1"
)

// logBuffer collects the JSON lines of a logx logger; safe for the
// concurrent writes of an HTTP client.
type logBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *logBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	_, _ = b.buf.Write(p) // a bytes.Buffer write cannot fail
	return len(p), nil
}

func (b *logBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// lines decodes every log line.
func (b *logBuffer) lines(t *testing.T) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(b.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		out = append(out, m)
	}
	return out
}

// newLogger returns a logger writing JSON into a new logBuffer.
func newLogger() (logx.Logger, *logBuffer) {
	buf := &logBuffer{}
	return logx.New(logx.WithOutput(buf), logx.WithLevel("debug"), logx.WithFormat("json")), buf
}

// newTestClient is a client on the test servers' URLs with a 2s timeout.
func newTestClient(snapURL, apiURL string, opts ...Option) *Client {
	return New(testServerKey, testClientKey, 2*time.Second, append([]Option{WithBaseURLs(snapURL, apiURL)}, opts...)...)
}
