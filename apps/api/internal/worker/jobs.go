package worker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// The scheduled jobs' task types. Each runs one service method that was
// already safe to run twice at once (guarded UPDATEs, SKIP LOCKED), and is
// also an `api …` command for operators.
const (
	TypePublishEvents         = "outbox:publish"
	TypeExpireOrders          = "orders:expire"
	TypeReconcilePayments     = "payments:reconcile"
	TypeProcessImages         = "images:process"
	TypeCleanupIdempotency    = "idempotency:cleanup"
	TypeCleanupRefreshTokens  = "auth:cleanup-refresh-tokens" // #nosec G101 -- a task name, not a credential
	TypeCleanupGuestCarts     = "carts:cleanup-guests"
	TypeCleanupPendingUploads = "images:cleanup-pending"
)

// Periodic is one scheduled job: its task type, how often it runs (an
// Asynq cron spec) and how long one run may take.
type Periodic struct {
	Type    string
	Every   time.Duration
	Timeout time.Duration
}

// Spec is p's schedule as an Asynq cron spec.
func (p Periodic) Spec() string { return "@every " + p.Every.String() }

// Schedule is every scheduled job (ADR 0007).
var Schedule = []Periodic{
	{Type: TypePublishEvents, Every: 5 * time.Second, Timeout: 30 * time.Second},
	{Type: TypeExpireOrders, Every: time.Minute, Timeout: time.Minute},
	{Type: TypeProcessImages, Every: 30 * time.Second, Timeout: 2 * time.Minute},
	{Type: TypeReconcilePayments, Every: 5 * time.Minute, Timeout: 4 * time.Minute},
	{Type: TypeCleanupIdempotency, Every: time.Hour, Timeout: 10 * time.Minute},
	{Type: TypeCleanupRefreshTokens, Every: time.Hour, Timeout: 10 * time.Minute},
	{Type: TypeCleanupGuestCarts, Every: time.Hour, Timeout: 10 * time.Minute},
	{Type: TypeCleanupPendingUploads, Every: time.Hour, Timeout: 10 * time.Minute},
}

// Jobs runs the scheduled jobs. Every dependency but the database may be
// nil: a job whose service is off (no gateway, no bucket) does nothing.
type Jobs struct {
	orders    *order.Service
	payments  *payment.Service
	images    *product.ImageService
	carts     *cart.PostgresRepository
	tokens    *auth.PostgresRepository
	publisher outbox.Publisher
	db        *sql.DB
	now       func() time.Time
}

// JobDeps is what Jobs needs.
type JobDeps struct {
	DB *sql.DB
	// Gateway is the payment gateway; nil when payments are off.
	Gateway payment.Gateway
	// Store is the image bucket; nil when uploads are off.
	Store product.ObjectStore
	// Publisher receives the outbox's events.
	Publisher outbox.Publisher
	// Clock is the current time; time.Now when nil.
	Clock func() time.Time
}

// NewJobs builds the jobs on deps.
func NewJobs(deps JobDeps) *Jobs {
	j := &Jobs{
		orders:    order.NewService(order.Deps{Repo: order.NewPostgresRepository(deps.DB), Clock: deps.Clock}),
		carts:     cart.NewPostgresRepository(deps.DB),
		tokens:    auth.NewPostgresRepository(deps.DB),
		publisher: deps.Publisher,
		db:        deps.DB,
		now:       deps.Clock,
	}
	if j.now == nil {
		j.now = time.Now
	}
	if deps.Gateway != nil {
		j.payments = payment.NewService(payment.Deps{
			Repo: payment.NewPostgresRepository(deps.DB), Gateway: deps.Gateway, Clock: deps.Clock,
		})
	}
	if deps.Store != nil {
		j.images = product.NewImageService(product.NewPostgresRepository(deps.DB), deps.Store)
	}
	return j
}

// Register adds every job's handler to mux.
func (j *Jobs) Register(mux *asynq.ServeMux) {
	mux.HandleFunc(TypePublishEvents, j.PublishEvents)
	mux.HandleFunc(TypeExpireOrders, j.ExpireOrders)
	mux.HandleFunc(TypeReconcilePayments, j.ReconcilePayments)
	mux.HandleFunc(TypeProcessImages, j.ProcessImages)
	mux.HandleFunc(TypeCleanupIdempotency, j.CleanupIdempotencyKeys)
	mux.HandleFunc(TypeCleanupRefreshTokens, j.CleanupRefreshTokens)
	mux.HandleFunc(TypeCleanupGuestCarts, j.CleanupGuestCarts)
	mux.HandleFunc(TypeCleanupPendingUploads, j.CleanupPendingUploads)
}

// PublishEvents publishes the outbox's pending events.
func (j *Jobs) PublishEvents(ctx context.Context, _ *asynq.Task) error {
	n, err := outbox.NewDispatcher(j.db, j.publisher).PublishPending(ctx)
	return done(ctx, "published domain events", n, err)
}

// ExpireOrders cancels unpaid orders past their deadline (ADR 0006).
func (j *Jobs) ExpireOrders(ctx context.Context, _ *asynq.Task) error {
	n, err := j.orders.ExpireDue(ctx)
	return done(ctx, "expired unpaid orders", n, err)
}

// ReconcilePayments asks the gateway about open payments (ADR 0007).
func (j *Jobs) ReconcilePayments(ctx context.Context, _ *asynq.Task) error {
	if j.payments == nil {
		return nil
	}
	res, err := j.payments.Reconcile(ctx)
	return done(ctx, "reconciled payments", res.Changed, err)
}

// ProcessImages resizes confirmed product images (ADR 0007).
func (j *Jobs) ProcessImages(ctx context.Context, _ *asynq.Task) error {
	if j.images == nil {
		return nil
	}
	n, err := j.images.ProcessPending(ctx)
	return done(ctx, "processed product images", n, err)
}

// CleanupIdempotencyKeys deletes expired checkout idempotency keys.
func (j *Jobs) CleanupIdempotencyKeys(ctx context.Context, _ *asynq.Task) error {
	n, err := j.orders.CleanupKeys(ctx)
	return done(ctx, "deleted expired idempotency keys", int(n), err)
}

// CleanupRefreshTokens deletes expired refresh tokens (ADR 0005).
func (j *Jobs) CleanupRefreshTokens(ctx context.Context, _ *asynq.Task) error {
	n, err := j.tokens.DeleteExpiredRefreshTokens(ctx, j.now())
	return done(ctx, "deleted expired refresh tokens", int(n), err)
}

// CleanupGuestCarts deletes guest carts untouched for cart.GuestCartTTL.
func (j *Jobs) CleanupGuestCarts(ctx context.Context, _ *asynq.Task) error {
	n, err := j.carts.DeleteAbandonedGuestCarts(ctx, j.now())
	return done(ctx, "deleted abandoned guest carts", int(n), err)
}

// CleanupPendingUploads deletes uploads never confirmed.
func (j *Jobs) CleanupPendingUploads(ctx context.Context, _ *asynq.Task) error {
	if j.images == nil {
		return nil
	}
	n, err := j.images.CleanupPending(ctx, j.now())
	return done(ctx, "deleted abandoned uploads", n, err)
}

// done logs a job's result when it did something, and returns err with
// the job's name. A job that did nothing logs at debug only: most runs of
// a 5-second job find nothing.
func done(ctx context.Context, what string, n int, err error) error {
	log := logx.FromContext(ctx)
	if n > 0 {
		log.Info(what, "count", n)
	} else {
		log.Debug(what, "count", n)
	}
	if err != nil && !errors.Is(err, payment.ErrDisabled) {
		return fmt.Errorf("%s: %w", what, err)
	}
	return nil
}
