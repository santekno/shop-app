// Package config reads the API's configuration from environment variables and
// validates it once, at start. A bad value stops the process with a message
// that names the variable, instead of failing on the first request.
//
// The variables are documented in docs/configuration.md and .env.example.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"

	"github.com/santekno/sdk/configx"
)

// The values APP_ENV accepts. It switches log format and safety checks, never
// business logic.
const (
	EnvDevelopment = "development"
	EnvStaging     = "staging"
	EnvProduction  = "production"
)

// DefaultPort is used when neither PORT nor APP_PORT is set.
const DefaultPort = 8080

// Config is the validated configuration of the API.
type Config struct {
	// Env is APP_ENV: development, staging or production.
	Env string
	// Port is the TCP port to listen on: PORT (set by Railway) when present,
	// otherwise APP_PORT, otherwise DefaultPort.
	Port int
	// LogLevel is APP_LOG_LEVEL: debug, info (default), warn or error.
	LogLevel string
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
