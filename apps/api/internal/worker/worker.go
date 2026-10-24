// Package worker is GoShop's background worker (ADR 0007): a second
// binary from the API's module, cmd/worker, that runs Asynq tasks from
// Redis. It runs the scheduled jobs, and from Bab 6 artikel 08 the tasks
// the outbox publishes (emails, the seller's Telegram message). It serves
// no public HTTP: only /healthz and /readyz on $PORT for the platform.
package worker

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/health"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// Queue is the one queue GoShop's tasks use.
const Queue = "default"

// Run is the whole worker program. With no arguments it loads the config
// from the environment and runs until ctx is cancelled; with
// "healthcheck" it probes a running worker on the same port (the Docker
// health check); with "dead-tasks …" it lists or requeues the tasks that
// ran out of retries. cmd/worker/main.go only adds signal handling.
func Run(ctx context.Context, args []string, stdout io.Writer) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}
	logger := logging.NewService(stdout, cfg.IsDevelopment(), cfg.LogLevel, "worker").With("env", cfg.Env)
	switch {
	case len(args) == 0:
	case len(args) == 1 && args[0] == "healthcheck":
		return app.Probe(ctx, cfg.Port)
	case len(args) >= 1 && args[0] == "dead-tasks":
		rdb, err := redisconn.Open(ctx, cfg.RedisURL)
		if err != nil {
			return err
		}
		defer func() { _ = rdb.Close() }()
		return deadTasks(rdb, args[1:], stdout)
	default:
		return fmt.Errorf("unknown arguments %q (usage: worker [healthcheck|dead-tasks …])", args)
	}

	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()
	rdb, err := redisconn.Open(ctx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer func() { _ = rdb.Close() }()
	return serve(ctx, cfg, logger, db, rdb)
}

// serve runs the Asynq server, the scheduler and the health endpoints
// until ctx is cancelled, then stops them: health first (the platform sees
// the worker leave), then the scheduler (no new ticks), then the server,
// which waits up to APP_SHUTDOWN_TIMEOUT for running tasks.
func serve(ctx context.Context, cfg config.Config, logger logx.Logger, db *sql.DB, rdb *redis.Client) error {
	store, err := app.ObjectStore(cfg.Storage)
	if err != nil {
		return err
	}
	deps := JobDeps{DB: db, Gateway: app.PaymentGateway(cfg.Payment, logger), Publisher: outbox.LogPublisher{Logger: logger}}
	if store != nil {
		deps.Store = store
	}
	mux := asynq.NewServeMux()
	NewJobs(deps).Register(mux)
	orders := order.NewPostgresRepository(db)
	RegisterNotifications(mux, notify.NewEmails(app.WorkerMailer(cfg, logger), orders, user.NewPostgresRepository(db)))
	if cfg.Telegram.BotToken != "" {
		mux.HandleFunc(notify.TypeSellerPaidOrder,
			notify.NewTelegramSeller(cfg.Telegram.BotToken, cfg.Telegram.ChatID, orders).PaidOrder)
	} else {
		logger.Info("seller notifications are off: TELEGRAM_BOT_TOKEN is not set")
	}

	srv := asynq.NewServerFromRedisClient(rdb, asynq.Config{
		Concurrency: cfg.WorkerConcurrency,
		Queues:      map[string]int{Queue: 1},
		// Every task's context carries the worker's logger, so the
		// services log through logx.FromContext as they do in the API.
		BaseContext:     func() context.Context { return logx.WithContextLogger(context.Background(), logger) },
		Logger:          asynqLogger{logger},
		LogLevel:        asynq.InfoLevel,
		ShutdownTimeout: cfg.ShutdownTimeout,
		RetryDelayFunc:  RetryDelay,
		ErrorHandler:    asynq.ErrorHandlerFunc(logFailure),
	})
	scheduler := asynq.NewSchedulerFromRedisClient(rdb, &asynq.SchedulerOpts{
		Logger: asynqLogger{logger}, LogLevel: asynq.WarnLevel, Location: time.UTC,
		PostEnqueueFunc: enqueued(logger),
	})
	if err := register(scheduler); err != nil {
		return err
	}
	if err := srv.Start(mux); err != nil {
		return fmt.Errorf("start task server: %w", err)
	}
	defer srv.Shutdown()
	if err := scheduler.Start(); err != nil {
		return fmt.Errorf("start scheduler: %w", err)
	}
	defer scheduler.Shutdown()
	logger.Info("worker started", "concurrency", cfg.WorkerConcurrency, "jobs", len(Schedule))
	return serveHealth(ctx, cfg, logger, db, rdb)
}

// enqueued is the scheduler's after-enqueue hook. Asynq says nothing
// about a tick it could not enqueue unless told to. A duplicate is normal
// with two or more worker instances: each runs a scheduler, and the unique
// task lets one enqueue per tick win (debug). Anything else, Redis down
// for instance, means a job did not run (error).
func enqueued(logger logx.Logger) func(*asynq.TaskInfo, error) {
	return func(_ *asynq.TaskInfo, err error) {
		switch {
		case err == nil:
		case errors.Is(err, asynq.ErrDuplicateTask):
			logger.Debug("scheduled task already enqueued by another worker")
		default:
			logger.Error("could not enqueue a scheduled task", "error", err.Error())
		}
	}
}

// RegisterNotifications adds the email tasks' handlers to mux. The API
// queues TypeSendEmail; the outbox publishes the order emails (Bab 6
// artikel 11).
func RegisterNotifications(mux *asynq.ServeMux, emails *notify.Emails) {
	mux.HandleFunc(notify.TypeSendEmail, emails.SendQueued)
	mux.HandleFunc(notify.TypeOrderConfirmationEmail, emails.OrderConfirmation)
	mux.HandleFunc(notify.TypePaymentReceivedEmail, emails.PaymentReceived)
	mux.HandleFunc(notify.TypeOrderShippedEmail, emails.OrderShipped)
}

// register schedules every job of Schedule. Unique: when two worker
// instances (or a slow previous run) would enqueue the same job, Asynq
// keeps one, so a tick runs once.
func register(scheduler *asynq.Scheduler) error {
	for _, p := range Schedule {
		_, err := scheduler.Register(p.Spec(), asynq.NewTask(p.Type, nil),
			asynq.Queue(Queue), asynq.Timeout(p.Timeout), asynq.Unique(p.Every), notify.MaxRetry(p.Type))
		if err != nil {
			return fmt.Errorf("schedule %s: %w", p.Type, err)
		}
	}
	return nil
}

// serveHealth answers /healthz and /readyz (PostgreSQL and Redis) on the
// configured port until ctx is cancelled.
func serveHealth(ctx context.Context, cfg config.Config, logger logx.Logger, db *sql.DB, rdb *redis.Client) error {
	readiness := &health.Readiness{}
	h := health.NewHandler(logger, readiness, !cfg.IsDevelopment(),
		health.PostgresCheck(db), health.RedisCheck(redisconn.NewPinger(rdb)))
	r := chi.NewRouter()
	health.Routes(r, h)

	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", cfg.Addr())
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Addr(), err)
	}
	srv := httpserver.New(ln.Addr().String(), http.Handler(r), cfg.RequestTimeout)
	logger.Info("worker health listening", "addr", ln.Addr().String())
	return httpserver.Serve(ctx, srv, ln, httpserver.ShutdownOptions{
		OnDrain: readiness.StartDraining, Timeout: cfg.ShutdownTimeout, Logger: logger,
	})
}
