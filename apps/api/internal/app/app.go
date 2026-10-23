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
	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/address"
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
	"github.com/santekno/shop-app/apps/api/internal/order"
	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// App is the wired API, ready to serve.
type App struct {
	cfg       config.Config
	logger    logx.Logger
	readiness *health.Readiness
	handler   http.Handler
}

// New builds the API from cfg on db, the PostgreSQL pool, and rdb, the
// Redis client, that Run opened. Every dependency is created here and
// passed to the code that needs it; nothing reaches for a global. New
// closes neither: whoever opened them does, after the server has stopped.
func New(cfg config.Config, logger logx.Logger, db *sql.DB, rdb redis.UniversalClient, opts ...Option) *App {
	o := options{
		clock: time.Now,
		// Development logs every email with its token, so a developer can
		// copy it; elsewhere the body (and the token) is never logged.
		mailer:  mail.NewLogMailer(logger, cfg.IsDevelopment()),
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
	productHandler := product.NewHandler(productService, productService, validator)
	authHandler := auth.NewHandler(auth.HandlerDeps{
		Service:          authService,
		Validator:        validator,
		Limiter:          o.limiter,
		Clock:            o.clock,
		TrustedProxyHops: cfg.TrustedProxyHops,
	})
	orderHandler := order.NewHandler(orderService, orderService, orderService, validator).
		LimitPerBuyer(o.limiter, order.NewLimits(cfg.CheckoutLimitPerMinute))
	userHandler := user.NewHandler(userService, validator)
	addressHandler := address.NewHandler(addressService, validator)
	cartHandler := cart.NewHandler(cart.HandlerDeps{
		Service: cartService, Validator: validator, Limiter: o.limiter, TrustedProxyHops: cfg.TrustedProxyHops,
	})
	guard := auth.NewGuard(accessTokens, o.revocations)
	healthHandler := health.NewHandler(logger, readiness, !cfg.IsDevelopment(),
		health.PostgresCheck(db), health.RedisCheck(redisconn.NewPinger(rdb)))

	router := httpserver.NewRouter(httpserver.Options{
		Logger:         logger,
		AllowedOrigins: cfg.CORSAllowedOrigins,
		RequestTimeout: cfg.RequestTimeout,
		HSTS:           !cfg.IsDevelopment(),
		Probes:         func(r chi.Router) { health.Routes(r, healthHandler) },
	}, func(r chi.Router) {
		r.Route("/v1", func(r chi.Router) {
			categoryHandler.Routes(r)
			productHandler.Routes(r)
			authHandler.Routes(r)
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
				authHandler.ProtectedRoutes(r)
				// Store staff only: sellers manage the catalog, and admins
				// can do everything a seller can (docs/prd.md).
				r.With(auth.RequireRole(user.RoleSeller, user.RoleAdmin)).
					Route("/admin", func(r chi.Router) {
						productHandler.AdminRoutes(r)
						orderHandler.AdminRoutes(r)
					})
			})
		})
	})

	return &App{cfg: cfg, logger: logger, readiness: readiness, handler: router}
}

// shippingProvider is Biteship when BITESHIP_API_KEY is set, and the fixed
// rate table otherwise (ADR 0006).
func shippingProvider(cfg config.Shipping) shipping.Provider {
	if cfg.BiteshipAPIKey == "" {
		return shipping.Static{}
	}
	return shipping.NewBiteship(cfg.BiteshipAPIKey, shipping.BiteshipURL, cfg.Timeout)
}

// rateLimits is every limit the API counts in Redis.
func rateLimits(cfg config.Config) []auth.Limit {
	limits := append(slices.Clone(auth.Limits), cart.LimitGuestCartPerIP)
	return append(limits, order.NewLimits(cfg.CheckoutLimitPerMinute).All()...)
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

// Handler is the API's router with all middleware, for httptest.
func (a *App) Handler() http.Handler { return a.handler }

// Ready reports whether /readyz currently passes the server check.
func (a *App) Ready() bool { return !a.readiness.Draining() }

// Serve serves the API on ln until ctx is cancelled, then shuts down
// gracefully (see httpserver.Serve).
func (a *App) Serve(ctx context.Context, ln net.Listener) error {
	srv := httpserver.New(ln.Addr().String(), a.handler, a.cfg.RequestTimeout)
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
	default:
		return fmt.Errorf("unknown arguments %q (usage: api [healthcheck|migrate|expire-orders|cleanup-idempotency-keys])", args)
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
// exits: `api expire-orders`, `api cleanup-idempotency-keys`. Bab 5 has no worker yet, so a scheduler runs
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
	return nil
}
