// Package config reads the API's configuration from environment variables and
// validates it once, at start. A bad value stops the process with a message
// that names the variable, instead of failing on the first request.
//
// The variables are documented in docs/configuration.md and .env.example.
package config

import (
	"errors"
	"fmt"
	"net/mail"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/santekno/sdk/configx"
)

// The values APP_ENV accepts. It switches log format and safety checks, never
// business logic.
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvProduction  = "production"
)

// Defaults for variables that may be left unset.
const (
	// DefaultPort is used when neither PORT nor APP_PORT is set.
	DefaultPort = 8080
	// DefaultRequestTimeout is used when APP_REQUEST_TIMEOUT is not set.
	DefaultRequestTimeout = 15 * time.Second
	// maxRequestTimeout keeps one slow request from holding a connection,
	// and the server's write timeout derived from it, for minutes.
	maxRequestTimeout = 60 * time.Second
	// DefaultShutdownTimeout is used when APP_SHUTDOWN_TIMEOUT is not set.
	DefaultShutdownTimeout = 10 * time.Second
	// maxStopTime caps the drain delay and shutdown timeout. Docker and
	// Railway kill the process some time after SIGTERM, so waiting longer
	// would only be cut short.
	maxStopTime = 60 * time.Second

	// DefaultDBMaxOpenConns is used when APP_DB_MAX_OPEN_CONNS is not set.
	// Ten connections per instance leave room for several instances, the
	// worker and migrations under a small Postgres plan's connection limit.
	DefaultDBMaxOpenConns = 10
	// DefaultDBMaxIdleConns is used when APP_DB_MAX_IDLE_CONNS is not set.
	DefaultDBMaxIdleConns = 5
	// DefaultDBConnMaxLifetime is used when APP_DB_CONN_MAX_LIFETIME is not
	// set. Recycling connections lets a failover or a load balancer in front
	// of Postgres move them.
	DefaultDBConnMaxLifetime = 30 * time.Minute
	maxDBConns               = 100

	// DefaultAccessTokenTTL is used when APP_ACCESS_TOKEN_TTL is not set
	// (ADR 0005): short, because an access token cannot be recalled once
	// issued except through the session revocation check.
	DefaultAccessTokenTTL = 15 * time.Minute
	// DefaultRefreshTokenTTL is used when APP_REFRESH_TOKEN_TTL is not set:
	// a user who comes back within 30 days stays logged in.
	DefaultRefreshTokenTTL = 30 * 24 * time.Hour
	// MinJWTSecretBytes is the shortest JWT_SECRET accepted: HS256 needs a
	// key at least as long as its 32-byte output.
	MinJWTSecretBytes = 32
	// JWTSecretPlaceholder is the value in .env.example. It is accepted in
	// development only, so a copied example file never signs real tokens.
	JWTSecretPlaceholder = "change-me-to-a-long-random-string"

	// DefaultShippingTimeout is used when APP_SHIPPING_TIMEOUT is not set:
	// how long checkout waits for the courier rates API.
	DefaultShippingTimeout = 5 * time.Second
	// DefaultPaymentTTL is used when APP_PAYMENT_TTL is not set; it matches
	// Midtrans' default transaction expiry (Bab 6).
	DefaultPaymentTTL = 24 * time.Hour
	// DefaultCheckoutLimitPerMinute is used when
	// APP_CHECKOUT_LIMIT_PER_MINUTE is not set (order.DefaultLimitPerMinute).
	DefaultCheckoutLimitPerMinute = 30

	// DefaultWorkerConcurrency is used when APP_WORKER_CONCURRENCY is not
	// set: enough for emails and messages, few enough that the worker's
	// database connections stay within APP_DB_MAX_OPEN_CONNS.
	DefaultWorkerConcurrency = 5
	// DefaultPaymentTimeout is used when APP_PAYMENT_TIMEOUT is not set:
	// how long a call to the payment gateway may take.
	DefaultPaymentTimeout = 10 * time.Second
	// Midtrans sandbox keys start with these; GoShop takes no other
	// (ADR 0007: sandbox only).
	midtransServerKeyPrefix = "SB-Mid-server-"
	midtransClientKeyPrefix = "SB-Mid-client-"
)

// Config is the validated configuration of the API.
type Config struct {
	// Env is APP_ENV: development, staging or production.
	Env string
	// Port is the TCP port to listen on: PORT (set by Railway) when present,
	// otherwise APP_PORT, otherwise DefaultPort.
	Port int
	// LogLevel is APP_LOG_LEVEL: debug, info (default), warn or error.
	LogLevel string
	// CORSAllowedOrigins is APP_CORS_ALLOWED_ORIGINS, a comma-separated list
	// of browser origins (scheme://host[:port]) that may call the API. Empty
	// means no cross-origin browser access.
	CORSAllowedOrigins []string
	// RequestTimeout is APP_REQUEST_TIMEOUT (a Go duration such as "15s"):
	// how long a handler may run before the request ends with 503 TIMEOUT.
	RequestTimeout time.Duration
	// DrainDelay is APP_DRAIN_DELAY (default 0s): after SIGTERM, how long
	// /readyz reports "unavailable" while the server still accepts requests,
	// so a load balancer stops routing to it before connections close.
	DrainDelay time.Duration
	// ShutdownTimeout is APP_SHUTDOWN_TIMEOUT (default 10s): how long
	// in-flight requests may take to finish once shutdown starts.
	ShutdownTimeout time.Duration
	// Database is the PostgreSQL connection.
	Database Database
	// Auth configures tokens.
	Auth Auth
	// RedisURL is REDIS_URL, e.g. redis://localhost:6379/0 (rediss:// for
	// TLS). It may hold a password, so it is never logged.
	RedisURL string
	// TrustedProxyHops is APP_TRUSTED_PROXY_HOPS (0-5): how many proxies in
	// front of the API append to X-Forwarded-For. 0 trusts no header and
	// rate-limits by the TCP peer (httpapi.ClientIP). It defaults to 0 in
	// development only; staging and production must set it, because a wrong
	// value either lets clients forge their address or puts every client
	// behind the proxy's.
	TrustedProxyHops int
	// Shipping configures the courier rates (ADR 0006).
	Shipping Shipping
	// PaymentTTL is APP_PAYMENT_TTL (5m-72h, default 24h): how long a buyer
	// has to pay an order before it is cancelled and its stock returned.
	// At least 5 minutes, because Snap stops taking money a minute before
	// the deadline and counts whole minutes (Bab 6): a shorter TTL leaves
	// the buyer no time to pay.
	PaymentTTL time.Duration
	// CheckoutLimitPerMinute is APP_CHECKOUT_LIMIT_PER_MINUTE (1-100000,
	// default 30): how many previews, shipping quotes and checkouts one
	// buyer may ask for per minute, each.
	CheckoutLimitPerMinute int
	// Payment configures the payment gateway (ADR 0007).
	Payment Payment
	// Storage is the S3 bucket for product images (ADR 0007).
	Storage Storage
	// SMTP is the mail server; an empty Host keeps the log mailer.
	SMTP SMTP
	// Telegram is the seller's chat for new paid orders; empty is off.
	Telegram Telegram
	// WorkerConcurrency is APP_WORKER_CONCURRENCY (1-50, default 5): how
	// many tasks one worker process runs at once.
	WorkerConcurrency int
}

// Storage configures the S3 bucket. An empty Endpoint turns image uploads
// off (503 STORAGE_DISABLED).
type Storage struct {
	// Endpoint is S3_ENDPOINT: how the API and worker reach S3.
	Endpoint string
	// PresignEndpoint is S3_PRESIGN_ENDPOINT: the endpoint clients upload
	// to, when it differs from S3_ENDPOINT (Docker Compose:
	// http://localhost:8333 for the browser, http://storage:8333 inside).
	PresignEndpoint string
	// PublicURL is S3_PUBLIC_URL: the base URL the public reads images
	// from (a CDN, the bucket's public domain). Empty means
	// <presign endpoint>/<bucket>.
	PublicURL string
	// Region is S3_REGION (default us-east-1; auto for Cloudflare R2).
	Region string
	// Bucket is S3_BUCKET.
	Bucket string
	// AccessKey and SecretKey are S3_ACCESS_KEY and S3_SECRET_KEY; the
	// secret key is never logged.
	AccessKey string
	SecretKey string
}

// SMTP configures sending email (ADR 0007).
type SMTP struct {
	// Host is SMTP_HOST. Empty: emails are written to the log (bodies in
	// development only) instead of sent.
	Host string
	// Port is SMTP_PORT (default 587: STARTTLS; 465: TLS).
	Port int
	// Username and Password are SMTP_USERNAME and SMTP_PASSWORD, both or
	// neither; the password is a secret.
	Username string
	Password string
	// From is SMTP_FROM, the sender, e.g. GoShop <no-reply@shop.example>.
	From string
}

// Telegram configures the seller's chat notifications (ADR 0007).
type Telegram struct {
	// BotToken is TELEGRAM_BOT_TOKEN, from @BotFather; a secret, never
	// logged (it is part of every Bot API URL).
	BotToken string
	// ChatID is TELEGRAM_CHAT_ID: the seller's group or chat.
	ChatID string
}

// SeaweedFSSecretPlaceholder is the local SeaweedFS secret key of
// deploy/seaweedfs/s3.json and .env.example, accepted in development only.
const SeaweedFSSecretPlaceholder = "goshop-secret"

// Payment configures Midtrans, in the sandbox only.
type Payment struct {
	// MidtransServerKey is MIDTRANS_SERVER_KEY, a sandbox server key
	// (SB-Mid-server-…): it authenticates GoShop at Midtrans and signs
	// notifications. Empty turns payments off (503 PAYMENTS_DISABLED). A
	// secret, never logged.
	MidtransServerKey string
	// MidtransClientKey is MIDTRANS_CLIENT_KEY (SB-Mid-client-…), public by
	// design: clients hand it to Snap.js. Required with the server key.
	MidtransClientKey string
	// Timeout is APP_PAYMENT_TIMEOUT (1s-30s, default 10s).
	Timeout time.Duration
}

// Shipping configures where shipping fees come from.
type Shipping struct {
	// BiteshipAPIKey is BITESHIP_API_KEY. Empty turns Biteship off: the
	// fixed rate table (shipping.Static) prices every parcel instead. A
	// secret, never logged.
	BiteshipAPIKey string
	// OriginPostalCode is APP_SHIPPING_ORIGIN_POSTAL_CODE, the warehouse
	// parcels leave from: required when Biteship is on.
	OriginPostalCode string
	// Timeout is APP_SHIPPING_TIMEOUT (1s-15s, default 5s).
	Timeout time.Duration
}

// Auth configures the tokens of ADR 0005.
type Auth struct {
	// JWTSecret is JWT_SECRET, the HS256 key that signs access tokens: at
	// least 32 bytes, never logged or put in an error.
	JWTSecret []byte
	// AccessTokenTTL is APP_ACCESS_TOKEN_TTL (1m-1h, default 15m).
	AccessTokenTTL time.Duration
	// RefreshTokenTTL is APP_REFRESH_TOKEN_TTL (1h-2160h, default 720h):
	// how long a refresh token lives after it is issued.
	RefreshTokenTTL time.Duration
	// GoogleClientID is GOOGLE_CLIENT_ID, the OAuth client whose Google ID
	// tokens the API accepts. Required outside development; empty in
	// development turns Google sign-in off.
	GoogleClientID string
}

// Database configures the PostgreSQL connection pool.
type Database struct {
	// URL is DATABASE_URL, e.g. postgres://user:pass@host:5432/db?sslmode=disable.
	// It holds the password, so it is never logged or put in an error.
	URL string
	// MaxOpenConns is APP_DB_MAX_OPEN_CONNS (1-100, default 10): the most
	// connections this instance opens. A request that needs one more waits.
	MaxOpenConns int
	// MaxIdleConns is APP_DB_MAX_IDLE_CONNS (1 to MaxOpenConns, default 5):
	// how many unused connections stay open for the next request.
	MaxIdleConns int
	// ConnMaxLifetime is APP_DB_CONN_MAX_LIFETIME (1m-24h, default 30m):
	// a connection older than this is closed and replaced.
	ConnMaxLifetime time.Duration
}

// IsDevelopment reports whether the API runs on a developer's machine.
func (c Config) IsDevelopment() bool { return c.Env == EnvDevelopment }

// Addr is the listen address for http.Server, e.g. ":8080".
func (c Config) Addr() string { return ":" + strconv.Itoa(c.Port) }

// Load reads the configuration from the process environment and validates it.
// The error lists every invalid variable, not just the first one.
func Load() (Config, error) {
	// configx maps APP_<NAME> to the key "<name>", with every _ turned into
	// a dot: APP_ENV → "env", APP_LOG_LEVEL → "log.level".
	src, err := configx.Load(
		configx.WithEnv("APP"),
		configx.WithRequired("env"),
	)
	if err != nil {
		return Config{}, fmt.Errorf("config: %w (APP_ENV must be set to %s, %s or %s)",
			err, EnvDevelopment, EnvStaging, EnvProduction)
	}

	cfg := Config{
		Env:      src.String("env"),
		LogLevel: src.StringDefault("log.level", "info"),
	}
	errs := []error{validateEnv(cfg.Env), validateLogLevel(cfg.LogLevel)}

	// configx's typed getters turn a malformed number into 0 without an
	// error, so numbers are read as strings and parsed here.
	portVar, portValue := "APP_PORT", src.String("port")
	if v, ok := os.LookupEnv("PORT"); ok && v != "" {
		portVar, portValue = "PORT", v
	}
	cfg.Port, err = parsePort(portVar, portValue)
	errs = append(errs, err)

	cfg.CORSAllowedOrigins, err = parseOrigins(src.String("cors.allowed.origins"))
	errs = append(errs, err)

	cfg.RequestTimeout, err = parseDuration("APP_REQUEST_TIMEOUT", src.String("request.timeout"),
		DefaultRequestTimeout, time.Second, maxRequestTimeout)
	errs = append(errs, err)

	cfg.DrainDelay, err = parseDuration("APP_DRAIN_DELAY", src.String("drain.delay"),
		0, 0, maxStopTime)
	errs = append(errs, err)

	cfg.ShutdownTimeout, err = parseDuration("APP_SHUTDOWN_TIMEOUT", src.String("shutdown.timeout"),
		DefaultShutdownTimeout, time.Second, maxStopTime)
	errs = append(errs, err)

	// DATABASE_URL has no APP_ prefix: it is the name Railway's Postgres
	// plugin and most tools use.
	cfg.Database.URL, err = parseDatabaseURL(os.Getenv("DATABASE_URL"))
	errs = append(errs, err)

	cfg.Database.MaxOpenConns, err = parseInt("APP_DB_MAX_OPEN_CONNS", src.String("db.max.open.conns"),
		DefaultDBMaxOpenConns, 1, maxDBConns)
	errs = append(errs, err)

	cfg.Database.MaxIdleConns, err = parseInt("APP_DB_MAX_IDLE_CONNS", src.String("db.max.idle.conns"),
		DefaultDBMaxIdleConns, 1, maxDBConns)
	errs = append(errs, err)
	if err == nil && cfg.Database.MaxOpenConns > 0 && cfg.Database.MaxIdleConns > cfg.Database.MaxOpenConns {
		errs = append(errs, fmt.Errorf("APP_DB_MAX_IDLE_CONNS: must not be above APP_DB_MAX_OPEN_CONNS (%d), got %d",
			cfg.Database.MaxOpenConns, cfg.Database.MaxIdleConns))
	}

	cfg.Database.ConnMaxLifetime, err = parseDuration("APP_DB_CONN_MAX_LIFETIME", src.String("db.conn.max.lifetime"),
		DefaultDBConnMaxLifetime, time.Minute, 24*time.Hour)
	errs = append(errs, err)

	// JWT_SECRET has no APP_ prefix, like DATABASE_URL: it is a secret
	// that lives in the platform's secret store under its usual name.
	cfg.Auth.JWTSecret, err = parseJWTSecret(os.Getenv("JWT_SECRET"), cfg.Env)
	errs = append(errs, err)

	cfg.Auth.AccessTokenTTL, err = parseDuration("APP_ACCESS_TOKEN_TTL", src.String("access.token.ttl"),
		DefaultAccessTokenTTL, time.Minute, time.Hour)
	errs = append(errs, err)

	cfg.Auth.GoogleClientID, err = parseGoogleClientID(strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")), cfg.Env)
	errs = append(errs, err)

	cfg.Auth.RefreshTokenTTL, err = parseDuration("APP_REFRESH_TOKEN_TTL", src.String("refresh.token.ttl"),
		DefaultRefreshTokenTTL, time.Hour, 90*24*time.Hour)
	errs = append(errs, err)

	cfg.RedisURL, err = parseRedisURL(os.Getenv("REDIS_URL"))
	errs = append(errs, err)

	cfg.TrustedProxyHops, err = parseTrustedProxyHops(src.String("trusted.proxy.hops"), cfg.Env)
	errs = append(errs, err)

	cfg.Shipping, err = parseShipping(src)
	errs = append(errs, err)

	cfg.PaymentTTL, err = parseDuration("APP_PAYMENT_TTL", src.String("payment.ttl"),
		DefaultPaymentTTL, 5*time.Minute, 72*time.Hour)
	errs = append(errs, err)

	cfg.CheckoutLimitPerMinute, err = parseInt("APP_CHECKOUT_LIMIT_PER_MINUTE", src.String("checkout.limit.per.minute"),
		DefaultCheckoutLimitPerMinute, 1, 100_000)
	errs = append(errs, err)

	cfg.Payment, err = parsePayment(src)
	errs = append(errs, err)

	cfg.Storage, err = parseStorage(cfg.Env)
	errs = append(errs, err)

	cfg.SMTP, err = parseSMTP()
	errs = append(errs, err)

	cfg.Telegram = Telegram{
		BotToken: strings.TrimSpace(os.Getenv("TELEGRAM_BOT_TOKEN")),
		ChatID:   strings.TrimSpace(os.Getenv("TELEGRAM_CHAT_ID")),
	}
	if (cfg.Telegram.BotToken == "") != (cfg.Telegram.ChatID == "") {
		errs = append(errs, errors.New("TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID: set both (seller notifications on) or neither (off)"))
	}

	cfg.WorkerConcurrency, err = parseInt("APP_WORKER_CONCURRENCY", src.String("worker.concurrency"),
		DefaultWorkerConcurrency, 1, 50)
	errs = append(errs, err)

	if err := errors.Join(errs...); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	return cfg, nil
}

func validateEnv(env string) error {
	switch env {
	case EnvDevelopment, EnvStaging, EnvProduction:
		return nil
	default:
		return fmt.Errorf("APP_ENV: must be %s, %s or %s, got %q",
			EnvDevelopment, EnvStaging, EnvProduction, env)
	}
}

func validateLogLevel(level string) error {
	switch level {
	case "debug", "info", "warn", "error":
		return nil
	default:
		return fmt.Errorf("APP_LOG_LEVEL: must be debug, info, warn or error, got %q", level)
	}
}

// parsePort parses value as a port number; name is the variable it came from,
// so the error points at the right one. An empty value means DefaultPort.
func parsePort(name, value string) (int, error) {
	if value == "" {
		return DefaultPort, nil
	}
	port, err := strconv.Atoi(value)
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("%s: must be a number between 1 and 65535, got %q", name, value)
	}
	return port, nil
}

// parseDatabaseURL checks that value is a postgres:// URL. The value is a
// secret, so no error repeats it.
func parseDatabaseURL(value string) (string, error) {
	if value == "" {
		return "", errors.New("DATABASE_URL: is required, e.g. postgres://goshop:goshop@localhost:5432/goshop?sslmode=disable")
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" {
		return "", errors.New("DATABASE_URL: must be a URL like postgres://user:pass@host:5432/dbname")
	}
	return value, nil
}

// parseJWTSecret checks the signing key. The value is a secret, so no error
// repeats it. The .env.example placeholder, or anything that still says
// "change-me", is refused outside development.
func parseJWTSecret(value, env string) ([]byte, error) {
	switch {
	case value == "":
		return nil, errors.New("JWT_SECRET: is required; generate one with: openssl rand -base64 48")
	case len(value) < MinJWTSecretBytes:
		return nil, fmt.Errorf("JWT_SECRET: must be at least %d bytes, got %d; generate one with: openssl rand -base64 48",
			MinJWTSecretBytes, len(value))
	case env != EnvDevelopment && (value == JWTSecretPlaceholder || strings.Contains(strings.ToLower(value), "change-me")):
		return nil, errors.New("JWT_SECRET: is the placeholder from .env.example, which is allowed in development only; generate one with: openssl rand -base64 48")
	}
	return []byte(value), nil
}

// parseTrustedProxyHops reads APP_TRUSTED_PROXY_HOPS (0-5). Outside
// development it must be set, like GOOGLE_CLIENT_ID: there is no safe
// default for a deployment (Railway: 1, see docs/configuration.md).
func parseTrustedProxyHops(value, env string) (int, error) {
	if value == "" && env != EnvDevelopment {
		return 0, errors.New("APP_TRUSTED_PROXY_HOPS: is required outside development: the number of proxies that append to X-Forwarded-For (1 on Railway, 0 with none)")
	}
	return parseInt("APP_TRUSTED_PROXY_HOPS", value, 0, 0, 5)
}

// parseShipping reads BITESHIP_API_KEY (no APP_ prefix: a secret under its
// provider's name, like JWT_SECRET), APP_SHIPPING_ORIGIN_POSTAL_CODE and
// APP_SHIPPING_TIMEOUT.
func parseShipping(src *configx.Config) (Shipping, error) {
	sh := Shipping{
		BiteshipAPIKey:   strings.TrimSpace(os.Getenv("BITESHIP_API_KEY")),
		OriginPostalCode: strings.TrimSpace(src.String("shipping.origin.postal.code")),
	}
	var errs []error
	if sh.OriginPostalCode != "" && !postalCode.MatchString(sh.OriginPostalCode) {
		errs = append(errs, fmt.Errorf("APP_SHIPPING_ORIGIN_POSTAL_CODE: must be a 5-digit Indonesian postal code such as 40111, got %q", sh.OriginPostalCode))
	}
	if sh.BiteshipAPIKey != "" && sh.OriginPostalCode == "" {
		errs = append(errs, errors.New("APP_SHIPPING_ORIGIN_POSTAL_CODE: is required when BITESHIP_API_KEY is set: the postal code parcels are sent from"))
	}
	var err error
	sh.Timeout, err = parseDuration("APP_SHIPPING_TIMEOUT", src.String("shipping.timeout"),
		DefaultShippingTimeout, time.Second, 15*time.Second)
	errs = append(errs, err)
	return sh, errors.Join(errs...)
}

// parsePayment reads MIDTRANS_SERVER_KEY, MIDTRANS_CLIENT_KEY and
// MIDTRANS_IS_PRODUCTION (no APP_ prefix: Midtrans' own names) and
// APP_PAYMENT_TIMEOUT. The course takes money in the sandbox only, so
// MIDTRANS_IS_PRODUCTION must be false and the keys must be sandbox keys.
// No error repeats a key.
func parsePayment(src *configx.Config) (Payment, error) {
	p := Payment{
		MidtransServerKey: strings.TrimSpace(os.Getenv("MIDTRANS_SERVER_KEY")),
		MidtransClientKey: strings.TrimSpace(os.Getenv("MIDTRANS_CLIENT_KEY")),
	}
	var errs []error
	switch strings.TrimSpace(os.Getenv("MIDTRANS_IS_PRODUCTION")) {
	case "", "false":
	case "true":
		errs = append(errs, errors.New("MIDTRANS_IS_PRODUCTION: must be false: GoShop uses the Midtrans sandbox only"))
	default:
		errs = append(errs, errors.New("MIDTRANS_IS_PRODUCTION: must be false or empty"))
	}
	switch {
	case p.MidtransServerKey == "" && p.MidtransClientKey != "":
		errs = append(errs, errors.New("MIDTRANS_SERVER_KEY: is required when MIDTRANS_CLIENT_KEY is set"))
	case p.MidtransServerKey != "" && !strings.HasPrefix(p.MidtransServerKey, midtransServerKeyPrefix):
		errs = append(errs, errors.New("MIDTRANS_SERVER_KEY: must be a sandbox server key ("+midtransServerKeyPrefix+"…): GoShop uses the Midtrans sandbox only"))
	case p.MidtransServerKey != "" && !strings.HasPrefix(p.MidtransClientKey, midtransClientKeyPrefix):
		errs = append(errs, errors.New("MIDTRANS_CLIENT_KEY: is required with MIDTRANS_SERVER_KEY and must be a sandbox client key ("+midtransClientKeyPrefix+"…)"))
	}
	var err error
	p.Timeout, err = parseDuration("APP_PAYMENT_TIMEOUT", src.String("payment.timeout"),
		DefaultPaymentTimeout, time.Second, 30*time.Second)
	errs = append(errs, err)
	return p, errors.Join(errs...)
}

// parseStorage reads the S3_* variables (no APP_ prefix: the usual names
// of S3 tools). Only S3_ENDPOINT turns storage on; then the bucket and
// both keys are required. No error repeats a key.
func parseStorage(env string) (Storage, error) {
	st := Storage{
		Endpoint:        strings.TrimSpace(os.Getenv("S3_ENDPOINT")),
		PresignEndpoint: strings.TrimSpace(os.Getenv("S3_PRESIGN_ENDPOINT")),
		PublicURL:       strings.TrimRight(strings.TrimSpace(os.Getenv("S3_PUBLIC_URL")), "/"),
		Region:          strings.TrimSpace(os.Getenv("S3_REGION")),
		Bucket:          strings.TrimSpace(os.Getenv("S3_BUCKET")),
		AccessKey:       strings.TrimSpace(os.Getenv("S3_ACCESS_KEY")),
		SecretKey:       strings.TrimSpace(os.Getenv("S3_SECRET_KEY")),
	}
	if st.Endpoint == "" {
		return Storage{}, nil
	}
	if st.Region == "" {
		st.Region = "us-east-1"
	}
	var errs []error
	for name, value := range map[string]string{"S3_ENDPOINT": st.Endpoint, "S3_PRESIGN_ENDPOINT": st.PresignEndpoint} {
		if value != "" && !isEndpoint(value) {
			errs = append(errs, fmt.Errorf("%s: must be an endpoint like http://localhost:8333 (scheme and host, no path)", name))
		}
	}
	if st.PublicURL != "" && !isHTTPURL(st.PublicURL) {
		errs = append(errs, errors.New("S3_PUBLIC_URL: must be an http(s) URL like https://images.example.com"))
	}
	if !bucketName.MatchString(st.Bucket) {
		errs = append(errs, fmt.Errorf("S3_BUCKET: is required with S3_ENDPOINT and must be a bucket name (3-63 lower-case letters, digits, dots, hyphens), got %q", st.Bucket))
	}
	if st.AccessKey == "" || st.SecretKey == "" {
		errs = append(errs, errors.New("S3_ACCESS_KEY, S3_SECRET_KEY: are required with S3_ENDPOINT"))
	}
	if env != EnvDevelopment && st.SecretKey == SeaweedFSSecretPlaceholder {
		errs = append(errs, errors.New("S3_SECRET_KEY: is the local SeaweedFS placeholder, which is allowed in development only"))
	}
	return st, errors.Join(errs...)
}

// parseSMTP reads the SMTP_* variables. Only SMTP_HOST turns SMTP on; then
// SMTP_FROM is required. No error repeats the password.
func parseSMTP() (SMTP, error) {
	sm := SMTP{
		Host:     strings.TrimSpace(os.Getenv("SMTP_HOST")),
		Username: strings.TrimSpace(os.Getenv("SMTP_USERNAME")),
		Password: os.Getenv("SMTP_PASSWORD"),
		From:     strings.TrimSpace(os.Getenv("SMTP_FROM")),
	}
	if sm.Host == "" {
		return SMTP{}, nil
	}
	var errs []error
	var err error
	sm.Port, err = parseInt("SMTP_PORT", strings.TrimSpace(os.Getenv("SMTP_PORT")), 587, 1, 65535)
	errs = append(errs, err)
	if addr, err := mail.ParseAddress(sm.From); err != nil || strings.ContainsAny(sm.From, "\r\n") || addr.Address == "" {
		errs = append(errs, errors.New("SMTP_FROM: is required with SMTP_HOST, e.g. GoShop <no-reply@shop.example>"))
	}
	if (sm.Username == "") != (sm.Password == "") {
		errs = append(errs, errors.New("SMTP_USERNAME, SMTP_PASSWORD: set both or neither"))
	}
	return sm, errors.Join(errs...)
}

// bucketName is an S3 bucket name.
var bucketName = regexp.MustCompile(`^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$`)

func isEndpoint(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" &&
		u.User == nil && (u.Path == "" || u.Path == "/") && u.RawQuery == ""
}

func isHTTPURL(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != "" && u.User == nil
}

// postalCode is an Indonesian postal code: five digits, never starting
// with 0 (the addresses_postal_code_check constraint).
var postalCode = regexp.MustCompile(`^[1-9][0-9]{4}$`)

// parseRedisURL checks that value is a redis:// or rediss:// URL. The value
// can hold a password, so no error repeats it.
func parseRedisURL(value string) (string, error) {
	if value == "" {
		return "", errors.New("REDIS_URL: is required, e.g. redis://localhost:6379/0")
	}
	u, err := url.Parse(value)
	if err != nil || (u.Scheme != "redis" && u.Scheme != "rediss") || u.Host == "" {
		return "", errors.New("REDIS_URL: must be a URL like redis://host:6379/0 (rediss:// for TLS)")
	}
	return value, nil
}

// parseGoogleClientID checks GOOGLE_CLIENT_ID: required outside development,
// and always shaped like a Google OAuth client ID.
func parseGoogleClientID(value, env string) (string, error) {
	switch {
	case value == "" && env != EnvDevelopment:
		return "", errors.New("GOOGLE_CLIENT_ID: is required outside development (Google Cloud console → APIs & Services → Credentials)")
	case value != "" && !strings.HasSuffix(value, ".apps.googleusercontent.com"):
		return "", fmt.Errorf("GOOGLE_CLIENT_ID: must end with .apps.googleusercontent.com, got %q", value)
	}
	return value, nil
}

// parseOrigins splits a comma-separated list of origins and checks each one.
// "*" is refused: the allowed origins are always listed explicitly, so a
// copied production config cannot open the API to every website.
func parseOrigins(value string) ([]string, error) {
	var origins []string
	var errs []error
	for raw := range strings.SplitSeq(value, ",") {
		origin := strings.TrimSpace(raw)
		if origin == "" {
			continue
		}
		if err := checkOrigin(origin); err != nil {
			errs = append(errs, fmt.Errorf("APP_CORS_ALLOWED_ORIGINS: %q %w", origin, err))
			continue
		}
		origins = append(origins, origin)
	}
	return origins, errors.Join(errs...)
}

func checkOrigin(origin string) error {
	if origin == "*" {
		return errors.New("is not allowed: list each origin explicitly")
	}
	u, err := url.Parse(origin)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" ||
		u.User != nil || (u.Path != "" && u.Path != "/") || u.RawQuery != "" || u.Fragment != "" {
		return errors.New("must be an origin like https://shop.example.com or http://localhost:5173")
	}
	if u.Path == "/" {
		return errors.New("must not end with a slash: browsers send the origin without one")
	}
	return nil
}

// parseInt parses a whole number between minValue and maxValue; an empty
// value means def.
func parseInt(name, value string, def, minValue, maxValue int) (int, error) {
	if value == "" {
		return def, nil
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < minValue || n > maxValue {
		return 0, fmt.Errorf("%s: must be a number between %d and %d, got %q", name, minValue, maxValue, value)
	}
	return n, nil
}

// parseDuration parses a Go duration ("15s", "1m") between minDuration and
// maxDuration; an empty value means def.
func parseDuration(name, value string, def, minDuration, maxDuration time.Duration) (time.Duration, error) {
	if value == "" {
		return def, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil || d < minDuration || d > maxDuration {
		return 0, fmt.Errorf("%s: must be a duration between %s and %s, such as \"15s\", got %q",
			name, minDuration, maxDuration, value)
	}
	return d, nil
}
