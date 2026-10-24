package worker

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/storage"
)

// jobNow is the fixed clock of these tests.
var jobNow = time.Date(2026, 11, 1, 3, 0, 0, 0, time.UTC)

func fixedClock() time.Time { return jobNow }

// fakeGateway is a payment gateway that knows no transaction.
type fakeGateway struct{}

func (fakeGateway) Name() string      { return "fake-test" }
func (fakeGateway) ClientKey() string { return "client-key" }
func (fakeGateway) CreateTransaction(context.Context, payment.TransactionRequest) (payment.Transaction, error) {
	return payment.Transaction{}, errors.New("not used")
}

func (fakeGateway) Status(context.Context, string) (payment.TransactionStatus, error) {
	return payment.TransactionStatus{}, payment.ErrTransactionNotFound
}
func (fakeGateway) VerifySignature(string, string, string, string) bool { return false }

// fakeStore is an image bucket that records what was deleted.
type fakeStore struct {
	mu      sync.Mutex
	deleted []string
}

func (s *fakeStore) PresignPut(context.Context, string, string, int64, time.Duration) (storage.PresignedUpload, error) {
	return storage.PresignedUpload{}, nil
}
func (s *fakeStore) Stat(context.Context, string) (storage.ObjectInfo, error) {
	return storage.ObjectInfo{}, nil
}

func (s *fakeStore) Get(context.Context, string) (io.ReadCloser, error) {
	return io.NopCloser(strings.NewReader("")), nil
}

func (s *fakeStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, key)
	return nil
}

func (s *fakeStore) Put(context.Context, string, string, io.Reader) (string, error) { return "", nil }
func (s *fakeStore) PublicURL(key string) string                                    { return "https://img.test/" + key }

// recordingPublisher records the events it is handed.
type recordingPublisher struct {
	mu     sync.Mutex
	events []outbox.Event
}

func (p *recordingPublisher) Publish(_ context.Context, e outbox.Event) error {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.events = append(p.events, e)
	return nil
}

// jobContext is a task context carrying a JSON logger at debug level, as
// the worker's BaseContext does.
func jobContext() (context.Context, *bytes.Buffer) {
	var logs bytes.Buffer
	logger := logx.New(logx.WithOutput(&logs), logx.WithFormat("json"), logx.WithLevel("debug"))
	return logx.WithContextLogger(context.Background(), logger), &logs
}

// logLine is one JSON log line of a job.
type logLine struct {
	Level string `json:"level"`
	Msg   string `json:"msg"`
	Count int    `json:"count"`
}

func lastLogLine(t *testing.T, logs *bytes.Buffer) logLine {
	t.Helper()
	lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
	var l logLine
	if err := json.Unmarshal([]byte(lines[len(lines)-1]), &l); err != nil {
		t.Fatalf("decode log %q: %v", logs.String(), err)
	}
	return l
}

func TestNewJobs_OptionalServicesStayOff(t *testing.T) {
	db := newFakeSQL()
	j := NewJobs(JobDeps{DB: db.open(t)})
	testx.AssertTrue(t, j.payments == nil, "no gateway: no payment service")
	testx.AssertTrue(t, j.images == nil, "no bucket: no image service")
	testx.AssertTrue(t, j.now != nil, "time.Now when Clock is nil")

	ctx, logs := jobContext()
	for name, job := range map[string]asynq.HandlerFunc{
		"reconcile":       j.ReconcilePayments,
		"process images":  j.ProcessImages,
		"cleanup uploads": j.CleanupPendingUploads,
	} {
		testx.AssertNoError(t, job(ctx, asynq.NewTask("x", nil)), name)
	}
	testx.AssertEqual(t, len(db.names()), 0, "a job whose service is off touches nothing: %v", db.names())
	testx.AssertEqual(t, logs.Len(), 0, "and logs nothing")
}

func TestJobs_RunTheirStatementsAtTheClock(t *testing.T) {
	tests := []struct {
		name string
		job  func(*Jobs) asynq.HandlerFunc
		// statement is the first statement the job runs; arg its first
		// argument, from the clock.
		statement string
		arg       time.Time
		logMsg    string
	}{
		{
			name: "cleanup outbox", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupOutbox },
			statement: "DeletePublishedEvents", arg: jobNow.Add(-outbox.Retention), logMsg: "deleted published outbox events",
		},
		{
			name: "expire orders", job: func(j *Jobs) asynq.HandlerFunc { return j.ExpireOrders },
			statement: "ListExpiredOrderIDs", arg: jobNow, logMsg: "expired unpaid orders",
		},
		{
			name: "cleanup idempotency keys", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupIdempotencyKeys },
			statement: "DeleteExpiredIdempotencyKeys", arg: jobNow, logMsg: "deleted expired idempotency keys",
		},
		{
			name: "cleanup refresh tokens", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupRefreshTokens },
			statement: "DeleteExpiredRefreshTokens", arg: jobNow, logMsg: "deleted expired refresh tokens",
		},
		{
			name: "cleanup guest carts", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupGuestCarts },
			statement: "DeleteAbandonedGuestCarts", arg: jobNow.Add(-cart.GuestCartTTL), logMsg: "deleted abandoned guest carts",
		},
		{
			name: "reconcile payments", job: func(j *Jobs) asynq.HandlerFunc { return j.ReconcilePayments },
			statement: "ListPaymentsToReconcile", arg: jobNow.Add(-time.Minute), logMsg: "reconciled payments",
		},
		{
			name: "cleanup pending uploads", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupPendingUploads },
			statement: "DeleteStalePendingImages", arg: jobNow.Add(-product.PendingUploadTTL), logMsg: "deleted abandoned uploads",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL()
			// Every exec deletes nothing; every query finds nothing.
			for _, name := range []string{"DeletePublishedEvents", "DeleteOldDeliveries", "DeleteExpiredIdempotencyKeys",
				"DeleteExpiredRefreshTokens", "DeleteAbandonedGuestCarts"} {
				db.on(name, affected(0))
			}
			j := NewJobs(JobDeps{DB: db.open(t), Gateway: fakeGateway{}, Store: &fakeStore{}, Clock: fixedClock})
			ctx, logs := jobContext()

			err := tt.job(j)(ctx, asynq.NewTask("x", nil))

			testx.AssertNoError(t, err)
			c, ok := db.call(tt.statement)
			testx.AssertTrue(t, ok, "%s did not run: %v", tt.statement, db.names())
			got, isTime := c.args[0].(time.Time)
			testx.AssertTrue(t, isTime, "first argument %v is not a time", c.args)
			testx.AssertTrue(t, got.Equal(tt.arg), "%s ran at %s, want %s (the job's clock)", tt.statement, got, tt.arg)
			l := lastLogLine(t, logs)
			testx.AssertEqual(t, l, logLine{Level: "DEBUG", Msg: tt.logMsg, Count: 0}, "nothing done: debug only")
		})
	}
}

func TestJobs_ProcessImagesAsksForABatch(t *testing.T) {
	db := newFakeSQL()
	j := NewJobs(JobDeps{DB: db.open(t), Store: &fakeStore{}, Clock: fixedClock})
	ctx, logs := jobContext()

	testx.AssertNoError(t, j.ProcessImages(ctx, asynq.NewTask(TypeProcessImages, nil)))

	c, ok := db.call("ListProcessingImages")
	testx.AssertTrue(t, ok, "statements %v", db.names())
	testx.AssertEqual(t, len(c.args), 1)
	testx.AssertEqual(t, c.args[0], driver.Value(int64(product.ProcessBatchSize)))
	testx.AssertEqual(t, lastLogLine(t, logs), logLine{Level: "DEBUG", Msg: "processed product images", Count: 0})
}

// A job that did something logs it at INFO with the count.
func TestJobs_LogWorkDoneAtInfo(t *testing.T) {
	t.Run("refresh tokens deleted", func(t *testing.T) {
		db := newFakeSQL().on("DeleteExpiredRefreshTokens", affected(7))
		j := NewJobs(JobDeps{DB: db.open(t), Clock: fixedClock})
		ctx, logs := jobContext()
		testx.AssertNoError(t, j.CleanupRefreshTokens(ctx, nil))
		testx.AssertEqual(t, lastLogLine(t, logs), logLine{Level: "INFO", Msg: "deleted expired refresh tokens", Count: 7})
	})
	t.Run("abandoned uploads deleted from the bucket too", func(t *testing.T) {
		db := newFakeSQL().on("DeleteStalePendingImages", fakeAnswer{rows: [][]driver.Value{
			{"products/p1/i1/original"}, {"products/p1/i2/original"},
		}})
		store := &fakeStore{}
		j := NewJobs(JobDeps{DB: db.open(t), Store: store, Clock: fixedClock})
		ctx, logs := jobContext()
		testx.AssertNoError(t, j.CleanupPendingUploads(ctx, nil))
		testx.AssertEqual(t, strings.Join(store.deleted, ","), "products/p1/i1/original,products/p1/i2/original")
		testx.AssertEqual(t, lastLogLine(t, logs), logLine{Level: "INFO", Msg: "deleted abandoned uploads", Count: 2})
	})
}

func TestJobs_PublishEventsHandsTheOutboxToThePublisher(t *testing.T) {
	created := jobNow.Add(-time.Second)
	db := newFakeSQL().on("ClaimOutboxEvents", rows(
		"0193f1c2-0000-7000-8000-000000000001", "order", "0193f1c2-0000-7000-8000-0000000000aa",
		"order.paid", []byte(`{"order_id":"0193f1c2-0000-7000-8000-0000000000aa"}`), created,
	))
	pub := &recordingPublisher{}
	j := NewJobs(JobDeps{DB: db.open(t), Publisher: pub, Clock: fixedClock})
	ctx, logs := jobContext()

	testx.AssertNoError(t, j.PublishEvents(ctx, asynq.NewTask(TypePublishEvents, nil)))

	testx.AssertEqual(t, len(pub.events), 1)
	testx.AssertEqual(t, pub.events[0].ID, "0193f1c2-0000-7000-8000-000000000001")
	testx.AssertEqual(t, pub.events[0].Type, "order.paid")
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,ClaimOutboxEvents,MarkOutboxEventsPublished,COMMIT")
	testx.AssertEqual(t, lastLogLine(t, logs), logLine{Level: "INFO", Msg: "published domain events", Count: 1})
}

// A failing statement fails the task (so Asynq retries it), wrapped with
// what the job was doing.
func TestJobs_DatabaseErrorIsReturnedWithTheJobName(t *testing.T) {
	errDown := errors.New("connection reset by peer")
	tests := []struct {
		name      string
		statement string
		job       func(*Jobs) asynq.HandlerFunc
		prefix    string
	}{
		{name: "cleanup outbox", statement: "DeletePublishedEvents", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupOutbox }, prefix: "deleted published outbox events: "},
		{name: "publish events", statement: "ClaimOutboxEvents", job: func(j *Jobs) asynq.HandlerFunc { return j.PublishEvents }, prefix: "published domain events: "},
		{name: "expire orders", statement: "ListExpiredOrderIDs", job: func(j *Jobs) asynq.HandlerFunc { return j.ExpireOrders }, prefix: "expired unpaid orders: "},
		{name: "idempotency keys", statement: "DeleteExpiredIdempotencyKeys", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupIdempotencyKeys }, prefix: "deleted expired idempotency keys: "},
		{name: "refresh tokens", statement: "DeleteExpiredRefreshTokens", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupRefreshTokens }, prefix: "deleted expired refresh tokens: "},
		{name: "guest carts", statement: "DeleteAbandonedGuestCarts", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupGuestCarts }, prefix: "deleted abandoned guest carts: "},
		{name: "reconcile", statement: "ListPaymentsToReconcile", job: func(j *Jobs) asynq.HandlerFunc { return j.ReconcilePayments }, prefix: "reconciled payments: "},
		{name: "process images", statement: "ListProcessingImages", job: func(j *Jobs) asynq.HandlerFunc { return j.ProcessImages }, prefix: "processed product images: "},
		{name: "pending uploads", statement: "DeleteStalePendingImages", job: func(j *Jobs) asynq.HandlerFunc { return j.CleanupPendingUploads }, prefix: "deleted abandoned uploads: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on(tt.statement, failWith(errDown))
			j := NewJobs(JobDeps{
				DB: db.open(t), Gateway: fakeGateway{}, Store: &fakeStore{}, Publisher: &recordingPublisher{}, Clock: fixedClock,
			})
			ctx, _ := jobContext()

			err := tt.job(j)(ctx, nil)

			if err == nil {
				t.Fatalf("want an error, got nil (statements %v)", db.names())
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.prefix), "err = %v", err)
			testx.AssertTrue(t, errors.Is(err, errDown), "the cause is kept: %v", err)
		})
	}
}

func TestDone(t *testing.T) {
	errBoom := errors.New("boom")
	tests := []struct {
		name    string
		n       int
		err     error
		wantErr string
		level   string
	}{
		{name: "nothing done", n: 0, level: "DEBUG"},
		{name: "work done", n: 3, level: "INFO"},
		{name: "payments off is not a failure", n: 0, err: payment.ErrDisabled, level: "DEBUG"},
		{name: "wrapped payments off is not a failure", n: 0, err: errors.Join(errors.New("x"), payment.ErrDisabled), level: "DEBUG"},
		{name: "failure after some work", n: 2, err: errBoom, wantErr: "swept: boom", level: "INFO"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, logs := jobContext()
			err := done(ctx, "swept", tt.n, tt.err)
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
			} else {
				if err == nil {
					t.Fatalf("want %q, got nil", tt.wantErr)
				}
				testx.AssertEqual(t, err.Error(), tt.wantErr)
				testx.AssertTrue(t, errors.Is(err, errBoom))
			}
			testx.AssertEqual(t, lastLogLine(t, logs), logLine{Level: tt.level, Msg: "swept", Count: tt.n})
		})
	}
}
