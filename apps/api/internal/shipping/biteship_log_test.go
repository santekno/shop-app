package shipping

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
)

const refusalMsg = "biteship refused a rates request"

// warnLines is every JSON log line in logs whose msg is the refusal.
func warnLines(t *testing.T, logs *bytes.Buffer) []map[string]any {
	t.Helper()
	var out []map[string]any
	for _, l := range strings.Split(strings.TrimSpace(logs.String()), "\n") {
		if l == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(l), &m); err != nil {
			t.Fatalf("log line %q: %v", l, err)
		}
		if m["msg"] == refusalMsg {
			out = append(out, m)
		}
	}
	return out
}

func loggedQuote(t *testing.T, status int, body string) (*bytes.Buffer, string) {
	t.Helper()
	s := newBiteshipServer(t, answer(status, body))
	var logs bytes.Buffer
	b := NewBiteship(testAPIKey, s.URL, time.Second).WithLogger(logx.New(logx.WithOutput(&logs), logx.WithFormat("json")))
	_, err := b.Quote(context.Background(), parcel())
	testx.AssertError(t, err)
	return &logs, s.URL
}

// A refusal is logged once at WARN with the status and Biteship's code,
// and nothing that could hold a secret or a buyer's data: not the key,
// not the request, not Biteship's message.
func TestBiteship_LogsARefusal(t *testing.T) {
	for _, status := range []int{http.StatusBadRequest, http.StatusUnauthorized, http.StatusNotFound, http.StatusUnprocessableEntity, http.StatusTooManyRequests} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			logs, url := loggedQuote(t, status, `{"success":false,"error":"Origin postal code 40115 is not served for Budi","code":40001006}`)
			lines := warnLines(t, logs)
			testx.AssertEqual(t, len(lines), 1, "logs: %s", logs.String())
			l := lines[0]
			testx.AssertEqual(t, l["level"], any("WARN"))
			testx.AssertEqual(t, l["status"], any(float64(status)))
			testx.AssertEqual(t, l["biteship_code"], any(float64(40001006)))
			for k := range l {
				switch k {
				case "time", "level", "msg", "status", "biteship_code":
				default:
					t.Errorf("unexpected field %q in %v", k, l)
				}
			}
			text := logs.String()
			for _, secret := range []string{testAPIKey, "Budi", "not served", "40115", url, "/v1/rates/couriers"} {
				testx.AssertFalse(t, strings.Contains(text, secret), "%q is in the log: %s", secret, text)
			}
		})
	}
}

func TestBiteship_RefusalWithoutALogger(t *testing.T) {
	s := newBiteshipServer(t, answer(http.StatusBadRequest, `{"success":false,"code":40001006}`))
	_, err := NewBiteship(testAPIKey, s.URL, time.Second).Quote(context.Background(), parcel())
	// No logger: the refusal is not logged (and a nil logger never panics).
	testx.AssertTrue(t, errors.Is(err, ErrNotServed), "still the error, just not logged: %v", err)
}

// An outage is not a refusal: 5xx is not logged as one (it is ErrUnavailable
// and the API logs the 503 itself).
func TestBiteship_OutageIsNotARefusal(t *testing.T) {
	for _, status := range []int{http.StatusInternalServerError, http.StatusBadGateway, http.StatusServiceUnavailable} {
		logs, _ := loggedQuote(t, status, `{"success":false,"code":50000}`)
		testx.AssertEqual(t, len(warnLines(t, logs)), 0, "status %d: %s", status, logs.String())
	}
}

// Biteship's code is optional: a body without one, one that is not JSON,
// or one larger than the 4 KiB read still logs the status.
func TestBiteship_RefusalWithoutAUsableCode(t *testing.T) {
	tests := map[string]string{
		"no code":           `{"success":false,"error":"x"}`,
		"not JSON":          `<html>Bad Request</html>`,
		"empty":             ``,
		"over 4 KiB":        `{"success":false,"error":"` + strings.Repeat("x", 5000) + `","code":40001006}`,
		"code not a number": `{"code":"E1"}`,
	}
	for name, body := range tests {
		t.Run(name, func(t *testing.T) {
			logs, _ := loggedQuote(t, http.StatusBadRequest, body)
			lines := warnLines(t, logs)
			testx.AssertEqual(t, len(lines), 1, "logs: %s", logs.String())
			testx.AssertEqual(t, lines[0]["status"], any(float64(http.StatusBadRequest)))
			testx.AssertEqual(t, lines[0]["biteship_code"], any(float64(0)), "no code read")
			testx.AssertFalse(t, strings.Contains(logs.String(), "xxxx"), "no body text")
		})
	}
}

func TestBiteship_WithLoggerReturnsTheProvider(t *testing.T) {
	b := NewBiteship(testAPIKey, "http://localhost", time.Second)
	testx.AssertTrue(t, b.WithLogger(logx.Noop()) == b)
}
