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
		DefaultRequestTimeout, maxRequestTimeout)
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

// parseDuration parses a Go duration ("15s", "1m") between 1s and max; an
// empty value means def.
func parseDuration(name, value string, def, maxDuration time.Duration) (time.Duration, error) {
	if value == "" {
		return def, nil
	}
	d, err := time.ParseDuration(value)
	if err != nil || d < time.Second || d > maxDuration {
		return 0, fmt.Errorf("%s: must be a duration between 1s and %s, such as \"15s\", got %q",
			name, maxDuration, value)
	}
	return d, nil
}
