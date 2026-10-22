// Package config reads the API's configuration from environment variables and
// validates it once, at start. A bad value stops the process with a message
// that names the variable, instead of failing on the first request.
//
// The variables are documented in docs/configuration.md and .env.example.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
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
