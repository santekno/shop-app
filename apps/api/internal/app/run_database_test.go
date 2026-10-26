package app_test

import (
	"context"
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/migrations"
)

// setBab6Env is setEnv, and also clears the variables of Bab 6's
// services (payments, storage, mail, Telegram), so a developer's shell
// cannot turn one on.
func setBab6Env(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, name := range []string{
		"MIDTRANS_SERVER_KEY", "MIDTRANS_CLIENT_KEY", "MIDTRANS_IS_PRODUCTION",
		"S3_ENDPOINT", "S3_PRESIGN_ENDPOINT", "S3_PUBLIC_URL", "S3_REGION", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY",
		"SMTP_HOST", "SMTP_PORT", "SMTP_USERNAME", "SMTP_PASSWORD", "SMTP_FROM", "TELEGRAM_BOT_TOKEN", "TELEGRAM_CHAT_ID",
	} {
		t.Setenv(name, "")
		if err := os.Unsetenv(name); err != nil {
			t.Fatalf("unset %s: %v", name, err)
		}
	}
	setEnv(t, vars)
}

// logLines decodes Run's JSON log lines.
func logLines(t *testing.T, logs string) []map[string]any {
	t.Helper()
	var out []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(logs), "\n") {
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

// logLine returns the first log line with msg.
func logLine(t *testing.T, logs, msg string) (map[string]any, bool) {
	t.Helper()
	for _, l := range logLines(t, logs) {
		if l["msg"] == msg {
			return l, true
		}
	}
	return nil, false
}

// Serving with a database and Redis: the API listens on PORT until the
// context ends, then closes the pool and the client.
func TestRun_ServesUntilCancelled(t *testing.T) {
	pg := newFakePG(t, pgRule{match: "SHOW plan_cache_mode", rows: [][]string{{"force_custom_plan"}}})
	rdb := newFakeRedis(t)
	port := freePort(t)
	setBab6Env(t, map[string]string{
		"APP_ENV": "production", "PORT": strconv.Itoa(port), "DATABASE_URL": pg.url(), "REDIS_URL": "redis://" + rdb.addr() + "/0",
	})
	var out syncBuffer
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- app.Run(ctx, nil, &out) }()

	waitHealthy(t, port)
	cancel()
	select {
	case err := <-done:
		testx.AssertNoError(t, err)
	case <-time.After(10 * time.Second):
		t.Fatal("Run did not return after cancel")
	}
	for _, msg := range []string{"api listening", "database closed", "redis closed"} {
		_, ok := logLine(t, out.String(), msg)
		testx.AssertTrue(t, ok, "no %q in %s", msg, out.String())
	}
	_, warned := logLine(t, out.String(), "plan_cache_mode is not force_custom_plan; catalog searches may get slow generic plans")
	testx.AssertFalse(t, warned, "the session has custom plans")
}

func TestRun_ServeWithoutRedis(t *testing.T) {
	pg := newFakePG(t)
	setBab6Env(t, map[string]string{
		"APP_ENV": "production", "PORT": strconv.Itoa(freePort(t)), "DATABASE_URL": pg.url(),
		"REDIS_URL": refusingRedis(t),
	})
	var out syncBuffer
	err := app.Run(context.Background(), nil, &out)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open redis: "), "err = %v", err)
	_, closed := logLine(t, out.String(), "database closed")
	testx.AssertTrue(t, closed, "the pool opened first is closed: %s", out.String())
}

// refusingRedis is a REDIS_URL whose server answers every command with
// an error: Redis is "unreachable" at once, without go-redis's dial
// retries.
func refusingRedis(t *testing.T) string {
	t.Helper()
	f := newFakeRedis(t)
	f.mu.Lock()
	f.fail = true
	f.mu.Unlock()
	return "redis://" + f.addr() + "/0"
}

// latestMigration is the highest version in migrations.FS.
func latestMigration(t *testing.T) int {
	t.Helper()
	files, err := fs.Glob(migrations.FS, "*.up.sql")
	testx.AssertNoError(t, err)
	latest := 0
	for _, f := range files {
		v, err := strconv.Atoi(strings.SplitN(f, "_", 2)[0])
		testx.AssertNoError(t, err)
		latest = max(latest, v)
	}
	return latest
}

// migrated is the fake database of a schema already at version: what
// golang-migrate asks before it decides there is nothing to apply.
func migrated(t *testing.T, version int, extra ...pgRule) *fakePG {
	t.Helper()
	return newFakePG(t, append(extra,
		pgRule{match: "SELECT CURRENT_DATABASE()", rows: [][]string{{"goshop"}}},
		pgRule{match: "SELECT CURRENT_SCHEMA()", rows: [][]string{{"public"}}},
		pgRule{match: "FROM information_schema.tables", rows: [][]string{{"1"}}},
		pgRule{match: "SELECT version, dirty FROM", rows: [][]string{{strconv.Itoa(version), "false"}}},
	)...)
}

// s3Request is one request the fake S3 received.
type s3Request struct{ method, path string }

// fakeS3 answers HEAD with headStatus and everything else with 200, and
// records the requests.
func fakeS3(t *testing.T, headStatus int) (*httptest.Server, func() []s3Request) {
	t.Helper()
	var mu sync.Mutex
	var reqs []s3Request
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		reqs = append(reqs, s3Request{method: r.Method, path: r.URL.Path})
		mu.Unlock()
		_, _ = io.Copy(io.Discard, r.Body)
		if r.Method == http.MethodHead {
			w.WriteHeader(headStatus)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)
	return srv, func() []s3Request {
		mu.Lock()
		defer mu.Unlock()
		return append([]s3Request(nil), reqs...)
	}
}

// `api migrate` brings the schema up, then makes sure the image bucket
// exists (ADR 0007).
func TestRun_Migrate(t *testing.T) {
	latest := latestMigration(t)
	tests := []struct {
		name       string
		headStatus int // 0: no storage
		wantErr    string
		wantReqs   string
		wantBucket bool
	}{
		{name: "no storage: schema only"},
		{name: "the bucket exists", headStatus: http.StatusOK, wantReqs: "HEAD /goshop-images/", wantBucket: true},
		{name: "the bucket is created", headStatus: http.StatusNotFound, wantReqs: "HEAD /goshop-images/,PUT /goshop-images/", wantBucket: true},
		{name: "the bucket cannot be checked", headStatus: http.StatusForbidden, wantReqs: "HEAD /goshop-images/", wantErr: "storage: check bucket goshop-images: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pg := migrated(t, latest)
			env := map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url()}
			var requests func() []s3Request
			if tt.headStatus != 0 {
				var srv *httptest.Server
				srv, requests = fakeS3(t, tt.headStatus)
				env["S3_ENDPOINT"], env["S3_BUCKET"] = srv.URL, "goshop-images"
				env["S3_ACCESS_KEY"], env["S3_SECRET_KEY"] = "test-access", "test-secret"
			}
			setBab6Env(t, env)
			var out syncBuffer

			err := app.Run(context.Background(), strings.Fields("migrate"), &out)

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("want error %q, got nil", tt.wantErr)
				}
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wantErr), "err = %v", err)
			} else {
				testx.AssertNoError(t, err)
			}
			l, ok := logLine(t, out.String(), "database migrated")
			testx.AssertTrue(t, ok, "logs: %s", out.String())
			testx.AssertEqual(t, l["version"], any(float64(latest)))
			_, ready := logLine(t, out.String(), "image bucket ready")
			testx.AssertEqual(t, ready, tt.wantBucket)
			if requests != nil {
				var got []string
				for _, r := range requests() {
					got = append(got, r.method+" "+r.path)
				}
				testx.AssertEqual(t, strings.Join(got, ","), tt.wantReqs)
			}
		})
	}
}

func TestRun_MigrateFails(t *testing.T) {
	pg := newFakePG(t, pgRule{match: "SELECT CURRENT_DATABASE()", err: "permission denied"})
	setBab6Env(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url()})
	var out syncBuffer
	err := app.Run(context.Background(), strings.Fields("migrate"), &out)
	if err == nil {
		t.Fatal("want an error, got nil")
	}
	testx.AssertContains(t, err.Error(), "permission denied")
	_, ok := logLine(t, out.String(), "database migrated")
	testx.AssertFalse(t, ok, "nothing was migrated")
}

// Each one-shot job opens the database, runs once and closes it.
func TestRun_Jobs(t *testing.T) {
	tests := []struct {
		name      string
		statement string
		log       string
	}{
		{name: "expire-orders", statement: "ListExpiredOrderIDs", log: "expired unpaid orders"},
		{name: "cleanup-idempotency-keys", statement: "DeleteExpiredIdempotencyKeys", log: "deleted expired idempotency keys"},
		{name: "reconcile-payments", log: "payments are off: MIDTRANS_SERVER_KEY is not set; nothing to reconcile"},
		{name: "process-images", log: "image uploads are off: S3_ENDPOINT is not set; nothing to process"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pg := newFakePG(t)
			setBab6Env(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url()})
			var out syncBuffer

			testx.AssertNoError(t, app.Run(context.Background(), strings.Fields(tt.name), &out))

			if tt.statement != "" {
				_, ran := pg.call(tt.statement)
				testx.AssertTrue(t, ran, "statements %v", pg.names())
			}
			for _, msg := range []string{tt.log, "database closed"} {
				_, ok := logLine(t, out.String(), msg)
				testx.AssertTrue(t, ok, "no %q in %s", msg, out.String())
			}
		})
	}
	t.Run("a failing job names itself", func(t *testing.T) {
		pg := newFakePG(t, pgRule{match: "ListExpiredOrderIDs", err: "canceling statement due to statement timeout"})
		setBab6Env(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url()})
		var out syncBuffer
		err := app.Run(context.Background(), strings.Fields("expire-orders"), &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "expire-orders: "), "err = %v", err)
		testx.AssertContains(t, err.Error(), "statement timeout")
		_, closed := logLine(t, out.String(), "database closed")
		testx.AssertTrue(t, closed)
	})
}

// `api publish-events` hands the outbox to the worker's queue in Redis.
func TestRun_PublishEvents(t *testing.T) {
	t.Run("nothing pending", func(t *testing.T) {
		pg := newFakePG(t)
		rdb := newFakeRedis(t)
		setBab6Env(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url(), "REDIS_URL": "redis://" + rdb.addr() + "/0"})
		var out syncBuffer
		testx.AssertNoError(t, app.Run(context.Background(), strings.Fields("publish-events"), &out))
		names := strings.Join(pg.names(), ",")
		testx.AssertContains(t, names, "ClaimOutboxEvents")
		l, ok := logLine(t, out.String(), "published domain events")
		testx.AssertTrue(t, ok, "logs: %s", out.String())
		testx.AssertEqual(t, l["published"], any(float64(0)))
		for _, msg := range []string{"redis closed", "database closed"} {
			_, ok := logLine(t, out.String(), msg)
			testx.AssertTrue(t, ok, "no %q", msg)
		}
	})
	t.Run("the outbox cannot be read", func(t *testing.T) {
		pg := newFakePG(t, pgRule{match: "ClaimOutboxEvents", err: "relation does not exist"})
		rdb := newFakeRedis(t)
		setBab6Env(t, map[string]string{"APP_ENV": "production", "DATABASE_URL": pg.url(), "REDIS_URL": "redis://" + rdb.addr() + "/0"})
		var out syncBuffer
		err := app.Run(context.Background(), strings.Fields("publish-events"), &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "publish-events: claim outbox events: "), "err = %v", err)
	})
	t.Run("no redis", func(t *testing.T) {
		pg := newFakePG(t)
		setBab6Env(t, map[string]string{
			"APP_ENV": "production", "DATABASE_URL": pg.url(), "REDIS_URL": refusingRedis(t),
		})
		var out syncBuffer
		err := app.Run(context.Background(), strings.Fields("publish-events"), &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open redis: "), "err = %v", err)
		_, claimed := pg.call("ClaimOutboxEvents")
		testx.AssertFalse(t, claimed, "nothing is claimed without the queue: %v", pg.names())
	})
}

// paymentOrderID is a Midtrans order_id: the order code and 6 characters.
const paymentOrderID = "GS-20261101-7KQ2M9-K3D9QX"

// fakeAPI is the API fake-pay notifies: it records each notification
// and answers status.
func fakeAPI(t *testing.T, status int) (int, func() []map[string]string) {
	t.Helper()
	var mu sync.Mutex
	var got []map[string]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var n map[string]string
		_ = json.NewDecoder(r.Body).Decode(&n)
		n["path"] = r.URL.Path
		mu.Lock()
		got = append(got, n)
		mu.Unlock()
		w.WriteHeader(status)
		_, _ = io.WriteString(w, `{"data":{"outcome":"paid"}}`)
	}))
	t.Cleanup(srv.Close)
	return portOf(t, srv), func() []map[string]string {
		mu.Lock()
		defer mu.Unlock()
		return append([]map[string]string(nil), got...)
	}
}

// fakePayEnv is a staging configuration with the fake gateway on pg, the
// fake Redis holding one unpaid transaction, and the API on port.
func fakePayEnv(t *testing.T, pg *fakePG, port int) *fakeRedis {
	t.Helper()
	rdb := newFakeRedis(t)
	rdb.values["goshop:fake-payment:"+paymentOrderID] = `{"order_id":"` + paymentOrderID + `","amount":117000,"token":"snap-token"}`
	setBab6Env(t, map[string]string{
		"APP_ENV": "staging", "APP_PAYMENT_PROVIDER": "fake", "PORT": strconv.Itoa(port),
		"DATABASE_URL": pg.url(), "REDIS_URL": "redis://" + rdb.addr() + "/0",
	})
	return rdb
}

// storedTransaction is the fake transaction of paymentOrderID in rdb.
func storedTransaction(t *testing.T, rdb *fakeRedis) fake.Transaction {
	t.Helper()
	rdb.mu.Lock()
	raw := rdb.values["goshop:fake-payment:"+paymentOrderID]
	rdb.mu.Unlock()
	var tx fake.Transaction
	testx.AssertNoError(t, json.Unmarshal([]byte(raw), &tx))
	return tx
}

// `api fake-pay` does what Midtrans does when a buyer pays: the fake
// transaction takes the status and the API gets the signed notification.
func TestRun_FakePay(t *testing.T) {
	tests := []struct {
		name        string
		args        string
		rules       []pgRule
		wantStatus  string
		wantFraud   string
		wantCode    string
		wantLookups int
	}{
		{name: "a payment order_id, settled by default", args: paymentOrderID, wantStatus: "settlement", wantCode: "200"},
		{
			name: "an order code finds its open payment", args: "GS-20261101-7KQ2M9",
			rules:      []pgRule{{match: "GetOpenPaymentByOrderCode", rows: [][]string{{paymentOrderID}}}},
			wantStatus: "settlement", wantCode: "200", wantLookups: 1,
		},
		{name: "a status", args: paymentOrderID + " expire", wantStatus: "expire", wantCode: "407"},
		{name: "a capture under review", args: paymentOrderID + " capture challenge", wantStatus: "capture", wantFraud: "challenge", wantCode: "200"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pg := newFakePG(t, tt.rules...)
			port, notifications := fakeAPI(t, http.StatusOK)
			rdb := fakePayEnv(t, pg, port)
			var out syncBuffer

			testx.AssertNoError(t, app.Run(context.Background(), strings.Fields("fake-pay "+tt.args), &out))

			tx := storedTransaction(t, rdb)
			testx.AssertEqual(t, tx.Status, tt.wantStatus)
			testx.AssertEqual(t, tx.FraudStatus, tt.wantFraud)
			testx.AssertTrue(t, tx.TransactionID != "", "the transaction got an id")
			got := notifications()
			testx.AssertEqual(t, len(got), 1)
			n := got[0]
			testx.AssertEqual(t, n["path"], "/v1/payments/midtrans/notification")
			testx.AssertEqual(t, n["order_id"], paymentOrderID)
			testx.AssertEqual(t, n["status_code"], tt.wantCode)
			testx.AssertEqual(t, n["gross_amount"], "117000.00")
			testx.AssertTrue(t, fake.New(fake.NewMemoryStore()).VerifySignature(n["order_id"], n["status_code"], n["gross_amount"], n["signature_key"]),
				"the notification is signed like Midtrans signs it")
			lookup, looked := pg.call("GetOpenPaymentByOrderCode")
			testx.AssertEqual(t, looked, tt.wantLookups == 1)
			if looked {
				testx.AssertEqual(t, lookup.params[0], "GS-20261101-7KQ2M9")
			}
			l, ok := logLine(t, out.String(), "fake payment notification sent")
			testx.AssertTrue(t, ok, "logs: %s", out.String())
			testx.AssertEqual(t, l["answer"], any(float64(200)))
		})
	}
}

func TestRun_FakePayFails(t *testing.T) {
	tests := []struct {
		name      string
		args      string
		apiStatus int  // 0: nothing listens on PORT
		noRedis   bool // REDIS_URL points nowhere
		wantErr   string
	}{
		{name: "the API refuses the notification", args: paymentOrderID, apiStatus: http.StatusForbidden,
			wantErr: `fake-pay: the API answered 403: {"data":{"outcome":"paid"}}`},
		{name: "an unknown status", args: paymentOrderID + " paid", apiStatus: http.StatusOK, wantErr: "fake-pay: " + fake.ErrUnknownStatus.Error()},
		{name: "no such transaction", args: "GS-20261101-7KQ2M9-ZZZZZZ", apiStatus: http.StatusOK, wantErr: "fake-pay: "},
		{name: "no API running", args: paymentOrderID, wantErr: "fake-pay: fake: send notification: "},
		{name: "no Redis", args: paymentOrderID, apiStatus: http.StatusOK, noRedis: true, wantErr: "open redis: "},
		{name: "an order without an open payment", args: "GS-20261101-7KQ2M9", apiStatus: http.StatusOK,
			wantErr: "fake-pay: order GS-20261101-7KQ2M9 has no open payment; call POST /v1/orders/{id}/pay first"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pg := newFakePG(t)
			port := freePort(t)
			notifications := func() []map[string]string { return nil }
			if tt.apiStatus != 0 {
				port, notifications = fakeAPI(t, tt.apiStatus)
			}
			fakePayEnv(t, pg, port)
			if tt.noRedis {
				t.Setenv("REDIS_URL", refusingRedis(t))
			}
			var out syncBuffer

			err := app.Run(context.Background(), strings.Fields("fake-pay "+tt.args), &out)

			if err == nil {
				t.Fatalf("want error %q, got nil", tt.wantErr)
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wantErr), "err = %v", err)
			if tt.apiStatus != http.StatusForbidden {
				testx.AssertEqual(t, len(notifications()), 0, "no notification was sent")
			}
		})
	}
}
