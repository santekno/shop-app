// Package app wires the API together by hand, with no dependency-injection
// framework: config → logger → database → repositories → services → handlers
// → router → server. Reading New from top to bottom shows exactly what the API is made
// of and in which order it starts.
package app

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"net"
	"net/http"
	"slices"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/address"
	"github.com/santekno/shop-app/apps/api/internal/adminevents"
	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/health"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/httpserver"
	"github.com/santekno/shop-app/apps/api/internal/logging"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/notify"
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
	"github.com/santekno/shop-app/apps/api/internal/report"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
	"github.com/santekno/shop-app/apps/api/internal/storage"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// App is the wired API, ready to serve.
type App struct {
	cfg       config.Config
	logger    logx.Logger
	readiness *health.Readiness
	handler   http.Handler
	// events serves the admin's event streams, which Serve ends when the
	// server shuts down.
	events *adminevents.Handler
}

// New builds the API from cfg on db, the PostgreSQL pool, and rdb, the
// Redis client, that Run opened. Every dependency is created here and
// passed to the code that needs it; nothing reaches for a global. New
// closes neither: whoever opened them does, after the server has stopped.
func New(cfg config.Config, logger logx.Logger, db *sql.DB, rdb redis.UniversalClient, opts ...Option) *App {
	o := options{
		clock:   time.Now,
		mailer:  apiMailer(cfg, logger, rdb),
		limiter: auth.NewRedisRateLimiter(redisconn.NewCounter(rdb), rateLimits(cfg)),
		// Revoked sessions live in Redis as long as an access token
		// (ADR 0005).
		revocations: auth.NewRedisSessionRevocations(redisconn.NewKV(rdb), cfg.Auth.AccessTokenTTL),
	}
	for _, opt := range opts {
		opt(&o)
	}
	if o.google == nil && cfg.Auth.GoogleClientID != "" {
		o.google = auth.NewGoogleVerifier(cfg.Auth.GoogleClientID, o.clock)
	}
	if o.google == nil {
		logger.Info("google sign-in is off: GOOGLE_CLIENT_ID is not set")
	}
	readiness := &health.Readiness{}

	// Repositories: SQL on the shared pool.
	categoryRepo := category.NewPostgresRepository(db)
	productRepo := product.NewPostgresRepository(db)
	authRepo := auth.NewPostgresRepository(db)
	// Deleting an account also cancels its unpaid orders and deletes its
	// cart, in the same transaction (ADR 0006).
	userRepo := user.NewPostgresRepository(db, order.AccountCloser(o.clock))
	addressRepo := address.NewPostgresRepository(db)
	cartRepo := cart.NewPostgresRepository(db)
	orderRepo := order.NewPostgresRepository(db)

	// Services: the business rules, given their repositories.
	categoryService := category.NewService(categoryRepo)
	productService := product.NewService(productRepo, categoryService)
	userService := user.NewService(userRepo, o.revocations)
	addressService := address.NewService(addressRepo)
	cartService := cart.NewService(cartRepo)
	if o.shipping == nil {
		o.shipping = shippingProvider(cfg.Shipping)
		if b, ok := o.shipping.(*shipping.Biteship); ok {
			b.WithLogger(logger)
		}
	}
	logger.Info("shipping fees", "provider", o.shipping.Name())
	if cfg.Shipping.BiteshipAPIKey == "" && !cfg.IsDevelopment() {
		// Allowed, as a flat rate table, but easy to deploy by mistake.
		logger.Warn("BITESHIP_API_KEY is empty: shipping fees come from the fixed rate table, not from the couriers")
	}
	orderService := order.NewService(order.Deps{
		Repo: orderRepo, Clock: o.clock, Carts: cartService, Addresses: addressService, Shipping: o.shipping,
		OriginPostalCode: cfg.Shipping.OriginPostalCode, PaymentTTL: cfg.PaymentTTL,
	})
	if o.gateway == nil {
		o.gateway = PaymentGateway(cfg.Payment, logger, rdb)
	}
	if o.gateway == nil {
		logger.Warn("payments are off: MIDTRANS_SERVER_KEY is not set")
	} else {
		logger.Info("payments", "provider", o.gateway.Name())
	}
	paymentService := payment.NewService(payment.Deps{
		Repo: payment.NewPostgresRepository(db), Orders: orderService, Gateway: o.gateway, Clock: o.clock,
	})
	accessTokens := auth.NewAccessTokens(cfg.Auth.JWTSecret, cfg.Auth.AccessTokenTTL, o.clock)
	authService := auth.NewService(auth.Deps{
		Repo:        authRepo,
		Hasher:      auth.NewArgon2Hasher(auth.DefaultMaxConcurrentHashes),
		Access:      accessTokens,
		RefreshTTL:  cfg.Auth.RefreshTokenTTL,
		Mailer:      o.mailer,
		Google:      o.google,
		Revocations: o.revocations,
		Clock:       o.clock,
	})

	// Handlers: HTTP in and out, given their services.
	validator := httpapi.NewValidator()
	categoryHandler := category.NewHandler(categoryService)
	productHandler := product.NewHandler(productService, productService, validator).
		WithTable(product.NewTableService(productRepo))
	if o.store == nil {
		store, err := ObjectStore(cfg.Storage)
		if err != nil {
			// The configuration was validated already; a client that
			// cannot be built is logged and uploads stay off.
			logger.Error("image storage is off", "error", err.Error())
		} else if store != nil {
			o.store = store
		}
	}
	if o.store == nil {
		logger.Warn("image uploads are off: S3_ENDPOINT is not set")
		productHandler.WithImages(nil, nil)
	} else {
		productHandler.WithImages(product.NewImageService(productRepo, o.store), o.store.PublicURL)
	}
	authHandler := auth.NewHandler(auth.HandlerDeps{
		Service:          authService,
		Validator:        validator,
		Limiter:          o.limiter,
		Clock:            o.clock,
		TrustedProxyHops: cfg.TrustedProxyHops,
		WebSession: auth.WebSession{
			AllowedOrigins: cfg.CORSAllowedOrigins,
			InsecureCookie: !cfg.Auth.CookieSecure,
		},
	})
	if !cfg.Auth.CookieSecure {
		logger.Warn("the web session cookie is sent without Secure: APP_AUTH_COOKIE_SECURE=false (development only)")
	}
	orderHandler := order.NewHandler(orderService, orderService, orderService, validator).
		LimitPerBuyer(o.limiter, order.NewLimits(cfg.CheckoutLimitPerMinute))
	paymentHandler := payment.NewHandler(payment.HandlerDeps{
		Payer: paymentService, Limiter: o.limiter, TrustedProxyHops: cfg.TrustedProxyHops,
	})
	reportHandler := report.NewHandler(report.NewService(db), validator, o.clock)
	userHandler := user.NewHandler(userService, validator)
	addressHandler := address.NewHandler(addressService, validator)
	cartHandler := cart.NewHandler(cart.HandlerDeps{
		Service: cartService, Validator: validator, Limiter: o.limiter, TrustedProxyHops: cfg.TrustedProxyHops,
	})
	guard := auth.NewGuard(accessTokens, o.revocations)
	// The admin dashboard's live feed (ADR 0009): each stream subscribes
	// to the order events the worker publishes to Redis.
	eventsHandler := adminevents.NewHandler(adminevents.NewRedisSubscriber(rdb), o.clock)
	healthHandler := health.NewHandler(logger, readiness, !cfg.IsDevelopment(),
		health.PostgresCheck(db), health.RedisCheck(redisconn.NewPinger(rdb)))

	router := httpserver.NewRouter(httpserver.Options{
		Logger:         logger,
		AllowedOrigins: cfg.CORSAllowedOrigins,
		// Only the web session's endpoints take the refresh cookie.
		CredentialedPathPrefix: auth.WebPathPrefix,
		RequestTimeout:         cfg.RequestTimeout,
		HSTS:                   !cfg.IsDevelopment(),
		Probes:                 func(r chi.Router) { health.Routes(r, healthHandler) },
		// Outside the request timeout: a stream lives until its access
		// token expires. Staff only, like every /v1/admin route.
		Streams: func(r chi.Router) {
			r.With(guard.Authenticate, auth.RequireRole(user.RoleSeller, user.RoleAdmin)).
				Get("/v1/admin/events", eventsHandler.Stream)
		},
	}, func(r chi.Router) {
		r.Route("/v1", func(r chi.Router) {
			categoryHandler.Routes(r)
			productHandler.Routes(r)
			authHandler.Routes(r)
			// Called by Midtrans, which has no GoShop token: the
			// notification's signature is its authentication.
			paymentHandler.Routes(r)
			// Guests and logged-in users alike: a token, when sent, must
			// be valid.
			r.Group(func(r chi.Router) {
				r.Use(guard.Optional)
				cartHandler.Routes(r)
			})
			// Everything below needs a logged-in user.
			r.Group(func(r chi.Router) {
				r.Use(guard.Authenticate)
				userHandler.Routes(r)
				addressHandler.Routes(r)
				cartHandler.ProtectedRoutes(r)
				orderHandler.Routes(r)
				paymentHandler.ProtectedRoutes(r)
				authHandler.ProtectedRoutes(r)
				// Store staff only: sellers manage the catalog and the
				// orders, and admins can do everything a seller can
				// (docs/prd.md).
				r.With(auth.RequireRole(user.RoleSeller, user.RoleAdmin)).
					Route("/admin", func(r chi.Router) {
						productHandler.AdminRoutes(r)
						orderHandler.AdminRoutes(r)
						reportHandler.AdminRoutes(r)
						// Admins only: cancelling an order (Bab 12).
						r.Group(func(r chi.Router) {
							r.Use(auth.RequireRole(user.RoleAdmin))
							orderHandler.AdminOnlyRoutes(r)
						})
					})
			})
		})
	})

	return &App{cfg: cfg, logger: logger, readiness: readiness, handler: router, events: eventsHandler}
}

// shippingProvider is Biteship when BITESHIP_API_KEY is set, and the fixed
// rate table otherwise (ADR 0006).
func shippingProvider(cfg config.Shipping) shipping.Provider {
	if cfg.BiteshipAPIKey == "" {
		return shipping.Static{}
	}
	return shipping.NewBiteship(cfg.BiteshipAPIKey, shipping.BiteshipURL, cfg.Timeout)
}

// apiMailer is how the API sends its emails (verify, reset). With
// SMTP_HOST set they are queued for the worker, which sends them (ADR
// 0007). Without it they go to the log: development logs every email with
// its token, so a developer can copy it; elsewhere the body (and the
// token) is never logged.
func apiMailer(cfg config.Config, logger logx.Logger, rdb redis.UniversalClient) mail.Mailer {
	if cfg.SMTP.Host != "" {
		return notify.NewQueueMailer(asynq.NewClientFromRedisClient(rdb))
	}
	return mail.NewLogMailer(logger, cfg.IsDevelopment())
}

// WorkerMailer is how the worker sends email: SMTP when SMTP_HOST is set,
// otherwise the log, like the API.
func WorkerMailer(cfg config.Config, logger logx.Logger) mail.Mailer {
	if cfg.SMTP.Host == "" {
		return mail.NewLogMailer(logger, cfg.IsDevelopment())
	}
	return mail.NewSMTPMailer(mail.SMTPConfig{
		Host: cfg.SMTP.Host, Port: cfg.SMTP.Port, Username: cfg.SMTP.Username,
		Password: cfg.SMTP.Password, From: cfg.SMTP.From,
	})
}

// PaymentGateway is the fake when APP_PAYMENT_PROVIDER=fake (its
// transactions in rdb, shared by the API, the worker and api fake-pay),
// Midtrans when MIDTRANS_SERVER_KEY is set, and nil (payments off)
// otherwise (ADR 0007). Midtrans sends buyers back to cfg.FinishURL when it
// is set (APP_WEB_URL); the fake has no hosted page to come back from.
func PaymentGateway(cfg config.Payment, logger logx.Logger, rdb redis.UniversalClient) payment.Gateway {
	if cfg.Provider == config.PaymentFake {
		logger.Warn("payments go to the fake gateway (APP_PAYMENT_PROVIDER=fake): no money moves")
		return fake.New(fake.NewRedisStore(rdb))
	}
	if cfg.MidtransServerKey == "" {
		return nil
	}
	return midtrans.New(cfg.MidtransServerKey, cfg.MidtransClientKey, cfg.Timeout,
		midtrans.WithLogger(logger), midtrans.WithFinishURL(cfg.FinishURL))
}

// ObjectStore is the S3 bucket of cfg, or nil when S3_ENDPOINT is empty.
func ObjectStore(cfg config.Storage) (*storage.S3, error) {
	if cfg.Endpoint == "" {
		return nil, nil
	}
	s, err := storage.New(storage.Config{
		Endpoint: cfg.Endpoint, PresignEndpoint: cfg.PresignEndpoint, PublicURL: cfg.PublicURL,
		Region: cfg.Region, Bucket: cfg.Bucket, AccessKey: cfg.AccessKey, SecretKey: cfg.SecretKey,
	})
	if err != nil {
		return nil, fmt.Errorf("image storage: %w", err)
	}
	return s, nil
}

// rateLimits is every limit the API counts in Redis.
func rateLimits(cfg config.Config) []auth.Limit {
	limits := append(slices.Clone(auth.Limits), cart.LimitGuestCartPerIP)
	limits = append(limits, order.NewLimits(cfg.CheckoutLimitPerMinute).All()...)
	return append(limits, payment.Limits...)
}

// Option replaces one of the real dependencies New would build, for tests.
// Every seam of the auth flows is here, so an end-to-end test can run
// register → verify → login → refresh → reset without real email, Google
// or waiting for a token to expire.
type Option func(*options)

type options struct {
	clock       func() time.Time
	mailer      mail.Mailer
	google      auth.GoogleVerifier
	limiter     auth.RateLimiter
	revocations auth.SessionRevocations
	shipping    shipping.Provider
	gateway     payment.Gateway
	store       product.ObjectStore
}

// WithClock makes the auth flows read the time from now: token expiry,
// refresh and email-token lifetimes, "expires_in", Google's expiry check.
// sdk jwtx still checks an access token's exp against the wall clock (see
// docs/sdk-gaps.md), so keep now at or after the real time: a clock moved
// forward expires tokens; one moved back makes new access tokens fail.
func WithClock(now func() time.Time) Option { return func(o *options) { o.clock = now } }

// WithSessionRevocations replaces the Redis store of revoked sessions.
func WithSessionRevocations(r auth.SessionRevocations) Option {
	return func(o *options) { o.revocations = r }
}

// WithRateLimiter replaces the Redis rate limiter, for tests that need to
// control when a limit is hit.
func WithRateLimiter(l auth.RateLimiter) Option { return func(o *options) { o.limiter = l } }

// WithMailer makes the API send email through m instead of the log.
func WithMailer(m mail.Mailer) Option { return func(o *options) { o.mailer = m } }

// WithGoogleVerifier makes the API accept Google ID tokens that v accepts,
// for tests that cannot get a real token from Google.
func WithGoogleVerifier(v auth.GoogleVerifier) Option { return func(o *options) { o.google = v } }

// WithShippingProvider prices parcels with p instead of the provider the
// configuration picks, for tests that need a failing or fixed provider.
func WithShippingProvider(p shipping.Provider) Option { return func(o *options) { o.shipping = p } }

// WithPaymentGateway takes payments through g instead of the gateway the
// configuration picks, for tests that steer the gateway's answers.
func WithPaymentGateway(g payment.Gateway) Option { return func(o *options) { o.gateway = g } }

// WithObjectStore stores images in s instead of the S3 bucket the
// configuration names, for tests.
func WithObjectStore(s product.ObjectStore) Option { return func(o *options) { o.store = s } }

// Handler is the API's router with all middleware, for httptest.
func (a *App) Handler() http.Handler { return a.handler }

// Ready reports whether /readyz currently passes the server check.
func (a *App) Ready() bool { return !a.readiness.Draining() }

// Serve serves the API on ln until ctx is cancelled, then shuts down
// gracefully (see httpserver.Serve).
func (a *App) Serve(ctx context.Context, ln net.Listener) error {
	srv := httpserver.New(ln.Addr().String(), a.handler, a.cfg.RequestTimeout)
	// Event streams never finish on their own; end them as soon as the
	// shutdown starts, so it does not wait for them until its timeout.
	srv.RegisterOnShutdown(a.events.Shutdown)
	a.logger.Info("api listening", "addr", ln.Addr().String())
	return httpserver.Serve(ctx, srv, ln, httpserver.ShutdownOptions{
		OnDrain:    a.readiness.StartDraining,
		DrainDelay: a.cfg.DrainDelay,
		Timeout:    a.cfg.ShutdownTimeout,
		Logger:     a.logger,
	})
}

// Run is the whole program. With no arguments it loads the config from the
// environment, logs to stdout, listens on the configured port and serves
// until ctx is cancelled. With "healthcheck" it probes a running API on the
// same port instead (see Probe), and with "migrate" it applies the database
// migrations and exits (see runMigrations). main only adds signal handling
// and the exit code.
func Run(ctx context.Context, args []string, stdout io.Writer) error {
	// Fail fast: an invalid variable stops the program here, before
	// anything listens. There is no logger yet; its format depends on cfg.
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	logger := logging.New(stdout, cfg.IsDevelopment(), cfg.LogLevel).With("env", cfg.Env)
	switch {
	case len(args) == 0:
	case len(args) == 1 && args[0] == "healthcheck":
		return Probe(ctx, cfg.Port)
	case len(args) == 1 && args[0] == "migrate":
		return runMigrations(ctx, cfg, logger)
	case len(args) == 1 && args[0] == "expire-orders":
		return runJob(ctx, cfg, logger, "expire-orders", expireOrders)
	case len(args) == 1 && args[0] == "cleanup-idempotency-keys":
		return runJob(ctx, cfg, logger, "cleanup-idempotency-keys", cleanupIdempotencyKeys)
	case len(args) == 1 && args[0] == "publish-events":
		return runPublishEvents(ctx, cfg, logger)
	case len(args) == 1 && args[0] == "reconcile-payments":
		return runJob(ctx, cfg, logger, "reconcile-payments", reconcilePayments(cfg))
	case len(args) == 1 && args[0] == "process-images":
		return runJob(ctx, cfg, logger, "process-images", processImages(cfg.Storage))
	case len(args) >= 1 && args[0] == "fake-pay":
		return runFakePay(ctx, cfg, logger, args[1:])
	default:
		return fmt.Errorf("unknown arguments %q (usage: api [healthcheck|migrate|expire-orders|cleanup-idempotency-keys|publish-events|reconcile-payments|process-images|fake-pay])", args)
	}

	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	// Deferred, so the pool closes only after Serve has returned, which is
	// after the last in-flight request finished during graceful shutdown.
	defer closeDB(db, logger)

	rdb, err := redisconn.Open(ctx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer closeRedis(rdb, logger)

	// The Google key set fetches keys in the background for the life of the
	// process, so it gets its own context rather than this one.
	a := New(cfg, logger, db, rdb) //nolint:contextcheck // see above

	var lc net.ListenConfig
	ln, err := lc.Listen(ctx, "tcp", cfg.Addr())
	if err != nil {
		return fmt.Errorf("listen on %s: %w", cfg.Addr(), err)
	}
	return a.Serve(ctx, ln)
}

// closeDB closes the pool, waiting for queries still running to finish.
func closeDB(db *sql.DB, logger logx.Logger) {
	if err := db.Close(); err != nil {
		logger.Error("close database", "error", err.Error())
		return
	}
	logger.Info("database closed")
}

// closeRedis closes the Redis client after the server has stopped.
func closeRedis(rdb *redis.Client, logger logx.Logger) {
	if err := rdb.Close(); err != nil {
		logger.Error("close redis", "error", err.Error())
		return
	}
	logger.Info("redis closed")
}

// runJob runs one of the background jobs once against the database and
// exits: `api expire-orders`, `api cleanup-idempotency-keys`,
// `api publish-events`. Bab 5 has no worker yet, so a scheduler runs
// the command (make expire-orders locally, a Railway cron service in
// production); Bab 6's worker calls the same service methods on a ticker
// (ADR 0006). Each job is safe to run twice at once.
func runJob(ctx context.Context, cfg config.Config, logger logx.Logger, name string,
	job func(context.Context, *sql.DB, logx.Logger) error,
) error {
	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	defer closeDB(db, logger)
	if err := job(ctx, db, logger); err != nil {
		return fmt.Errorf("%s: %w", name, err)
	}
	return nil
}

// expireOrders cancels every unpaid order past its payment deadline and
// returns its stock (order.Service.ExpireDue).
func expireOrders(ctx context.Context, db *sql.DB, logger logx.Logger) error {
	svc := order.NewService(order.Deps{Repo: order.NewPostgresRepository(db)})
	n, err := svc.ExpireDue(ctx)
	logger.Info("expired unpaid orders", "cancelled", n)
	return err
}

// cleanupIdempotencyKeys deletes the checkout idempotency keys past their
// 24 hours (order.Service.CleanupKeys).
func cleanupIdempotencyKeys(ctx context.Context, db *sql.DB, logger logx.Logger) error {
	svc := order.NewService(order.Deps{Repo: order.NewPostgresRepository(db)})
	n, err := svc.CleanupKeys(ctx)
	logger.Info("deleted expired idempotency keys", "deleted", n)
	return err
}

// publishEvents publishes the outbox's pending domain events through
// publisher, once: what the worker does every 5 seconds, for an operator.
func publishEvents(publisher outbox.Publisher) func(context.Context, *sql.DB, logx.Logger) error {
	return func(ctx context.Context, db *sql.DB, logger logx.Logger) error {
		n, err := outbox.NewDispatcher(db, publisher).PublishPending(logx.WithContextLogger(ctx, logger))
		logger.Info("published domain events", "published", n)
		return err
	}
}

// runPublishEvents is `api publish-events`: the outbox to the worker's
// queue and the admin feed (EventPublisher), the same publisher the
// worker uses.
// The database is opened first, like every job.
func runPublishEvents(ctx context.Context, cfg config.Config, logger logx.Logger) error {
	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	defer closeDB(db, logger)
	rdb, err := redisconn.Open(ctx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer closeRedis(rdb, logger)
	if err := publishEvents(EventPublisher(cfg, rdb))(ctx, db, logger); err != nil {
		return fmt.Errorf("publish-events: %w", err)
	}
	return nil
}

// EventPublisher is where the outbox's domain events go, in the worker and
// in `api publish-events`: first the worker's tasks (emails, the seller's
// Telegram message; ADR 0007), then the admin dashboard's live feed (ADR
// 0009).
func EventPublisher(cfg config.Config, rdb redis.UniversalClient) outbox.Publisher {
	return outbox.Publishers{
		notify.NewQueuePublisher(asynq.NewClientFromRedisClient(rdb), notify.NewRoutes(cfg.Telegram.BotToken != "")),
		adminevents.NewPublisher(rdb),
	}
}

// reconcilePayments asks the payment gateway about the open payments and
// applies what it says (payment.Service.Reconcile), once: the safety net
// for a lost notification. With payments off it does nothing.
func reconcilePayments(cfg config.Config) func(context.Context, *sql.DB, logx.Logger) error {
	return func(ctx context.Context, db *sql.DB, logger logx.Logger) error {
		// Only the fake gateway needs Redis (its transactions live there).
		var rdb redis.UniversalClient
		if cfg.Payment.Provider == config.PaymentFake {
			c, err := redisconn.Open(ctx, cfg.RedisURL)
			if err != nil {
				return err
			}
			defer closeRedis(c, logger)
			rdb = c
		}
		gateway := PaymentGateway(cfg.Payment, logger, rdb)
		if gateway == nil {
			logger.Warn("payments are off: MIDTRANS_SERVER_KEY is not set; nothing to reconcile")
			return nil
		}
		svc := payment.NewService(payment.Deps{Repo: payment.NewPostgresRepository(db), Gateway: gateway})
		res, err := svc.Reconcile(logx.WithContextLogger(ctx, logger))
		logger.Info("reconciled payments", "checked", res.Checked, "changed", res.Changed, "failed", res.Failed)
		return err
	}
}

// processImages makes the variants of the confirmed product images
// (product.ImageService.ProcessPending), once. With storage off it does
// nothing.
func processImages(cfg config.Storage) func(context.Context, *sql.DB, logx.Logger) error {
	return func(ctx context.Context, db *sql.DB, logger logx.Logger) error {
		store, err := ObjectStore(cfg)
		if err != nil {
			return err
		}
		if store == nil {
			logger.Warn("image uploads are off: S3_ENDPOINT is not set; nothing to process")
			return nil
		}
		svc := product.NewImageService(product.NewPostgresRepository(db), store)
		n, err := svc.ProcessPending(logx.WithContextLogger(ctx, logger))
		logger.Info("processed product images", "finished", n)
		return err
	}
}

// runMigrations is `api migrate`: the one way a deployed database gets its
// schema. Docker Compose runs it as the one-shot migrate service before the
// api starts, and Railway as the api's pre-deploy command. The server itself
// never migrates, so a rollout cannot change the schema under instances that
// are still running the old code, and two instances never race to migrate.
func runMigrations(ctx context.Context, cfg config.Config, logger logx.Logger) error {
	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	version, err := database.Migrate(db)
	if err != nil {
		return err
	}
	logger.Info("database migrated", "version", version)
	// The image bucket is part of the environment the API needs, so the
	// same setup step creates it when it is missing (ADR 0007).
	store, err := ObjectStore(cfg.Storage)
	if err != nil || store == nil {
		return err
	}
	if err := store.EnsureBucket(ctx); err != nil {
		return err
	}
	logger.Info("image bucket ready", "bucket", cfg.Storage.Bucket)
	return nil
}
