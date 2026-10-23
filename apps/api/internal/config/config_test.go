package config_test

import (
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// testDatabaseURL is a valid DATABASE_URL. It has no login: the rows of
// TestLoad_DatabaseURL that need one use the secret scanner's placeholder
// (user:pass), the only one make scan allows in a URL.
const testDatabaseURL = "postgres://localhost:5432/goshop?sslmode=disable"

// Valid values for the other variables Load requires; none of them is real.
const (
	testJWTSecret      = "unit-test-jwt-secret-not-a-real-key-0123456789" //nolint:gosec // a test value, not a credential
	testGoogleClientID = "goshop-test.apps.googleusercontent.com"
	testRedisURL       = "redis://localhost:6379/0"
)

// setEnv gives the test a clean environment: every APP_* variable, PORT and
// DATABASE_URL is removed (and restored afterwards), then DATABASE_URL is set
// to testDatabaseURL, the one required variable without a default, and vars
// is applied over it. configx reads every APP_* variable of the process, so a
// stray one on the developer's machine must not leak into a test.
func setEnv(t *testing.T, vars map[string]string) {
	t.Helper()
	for _, kv := range os.Environ() {
		name, _, _ := strings.Cut(kv, "=")
		if strings.HasPrefix(name, "APP_") || name == "PORT" {
			unsetEnv(t, name)
		}
	}
	unsetEnv(t, "PORT")
	required := map[string]string{
		"DATABASE_URL":           testDatabaseURL,
		"JWT_SECRET":             testJWTSecret,
		"GOOGLE_CLIENT_ID":       testGoogleClientID,
		"REDIS_URL":              testRedisURL,
		"APP_TRUSTED_PROXY_HOPS": "0",
	}
	for name, value := range required {
		unsetEnv(t, name)
		if _, ok := vars[name]; !ok {
			t.Setenv(name, value)
		}
	}
	for k, v := range vars {
		t.Setenv(k, v)
	}
}

// unsetEnv removes name for the rest of the test; t.Setenv registers the
// restore of the original value.
func unsetEnv(t *testing.T, name string) {
	t.Helper()
	t.Setenv(name, "")
	if err := os.Unsetenv(name); err != nil {
		t.Fatalf("unset %s: %v", name, err)
	}
}

func TestLoad_Defaults(t *testing.T) {
	setEnv(t, map[string]string{"APP_ENV": "production"})

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	testx.AssertEqual(t, cfg.Env, config.EnvProduction)
	testx.AssertEqual(t, cfg.Port, config.DefaultPort)
	testx.AssertEqual(t, cfg.LogLevel, "info")
	testx.AssertEqual(t, len(cfg.CORSAllowedOrigins), 0)
	testx.AssertEqual(t, cfg.RequestTimeout, config.DefaultRequestTimeout)
	testx.AssertEqual(t, cfg.DrainDelay, time.Duration(0))
	testx.AssertEqual(t, cfg.ShutdownTimeout, config.DefaultShutdownTimeout)
	testx.AssertEqual(t, cfg.Database.URL, testDatabaseURL)
	testx.AssertEqual(t, cfg.Database.MaxOpenConns, config.DefaultDBMaxOpenConns)
	testx.AssertEqual(t, cfg.Database.MaxIdleConns, config.DefaultDBMaxIdleConns)
	testx.AssertEqual(t, cfg.Database.ConnMaxLifetime, config.DefaultDBConnMaxLifetime)
	// The documented defaults, so a changed constant is a visible decision.
	testx.AssertEqual(t, config.DefaultDBMaxOpenConns, 10)
	testx.AssertEqual(t, config.DefaultDBMaxIdleConns, 5)
	testx.AssertEqual(t, config.DefaultDBConnMaxLifetime, 30*time.Minute)
}

func TestLoad_Env(t *testing.T) {
	tests := []struct {
		name    string
		env     *string // nil: unset
		wantErr string
	}{
		{name: "development", env: ptr("development")},
		{name: "staging", env: ptr("staging")},
		{name: "production", env: ptr("production")},
		{name: "unset is required", env: nil, wantErr: "APP_ENV must be set to development, staging or production"},
		{name: "empty", env: ptr(""), wantErr: `APP_ENV: must be development, staging or production, got ""`},
		{name: "unknown", env: ptr("prod"), wantErr: `APP_ENV: must be development, staging or production, got "prod"`},
		{name: "case matters", env: ptr("Production"), wantErr: `got "Production"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{}
			if tt.env != nil {
				vars["APP_ENV"] = *tt.env
			}
			setEnv(t, vars)

			cfg, err := config.Load()
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Env, *tt.env)
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "config: "), "error is prefixed with config:")
		})
	}
}

func TestLoad_Port(t *testing.T) {
	tests := []struct {
		name     string
		vars     map[string]string
		wantPort int
		wantErr  string
	}{
		{name: "default", vars: nil, wantPort: config.DefaultPort},
		{name: "APP_PORT", vars: map[string]string{"APP_PORT": "9000"}, wantPort: 9000},
		{name: "PORT", vars: map[string]string{"PORT": "7000"}, wantPort: 7000},
		{name: "PORT beats APP_PORT", vars: map[string]string{"PORT": "7000", "APP_PORT": "9000"}, wantPort: 7000},
		{name: "empty PORT falls back to APP_PORT", vars: map[string]string{"PORT": "", "APP_PORT": "9000"}, wantPort: 9000},
		{name: "lowest port", vars: map[string]string{"APP_PORT": "1"}, wantPort: 1},
		{name: "highest port", vars: map[string]string{"APP_PORT": "65535"}, wantPort: 65535},
		{name: "APP_PORT zero", vars: map[string]string{"APP_PORT": "0"}, wantErr: `APP_PORT: must be a number between 1 and 65535, got "0"`},
		{name: "APP_PORT too high", vars: map[string]string{"APP_PORT": "65536"}, wantErr: `APP_PORT: must be a number between 1 and 65535, got "65536"`},
		{name: "APP_PORT negative", vars: map[string]string{"APP_PORT": "-1"}, wantErr: `APP_PORT: must be a number`},
		{name: "APP_PORT not a number", vars: map[string]string{"APP_PORT": "http"}, wantErr: `APP_PORT: must be a number between 1 and 65535, got "http"`},
		{name: "bad PORT names PORT", vars: map[string]string{"PORT": "abc", "APP_PORT": "9000"}, wantErr: `PORT: must be a number between 1 and 65535, got "abc"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{"APP_ENV": "development"}
			for k, v := range tt.vars {
				vars[k] = v
			}
			setEnv(t, vars)

			cfg, err := config.Load()
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Port, tt.wantPort)
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			if tt.vars["PORT"] != "" {
				// The variable actually used is the one named, never the other.
				testx.AssertFalse(t, strings.Contains(err.Error(), "APP_PORT"), "error names APP_PORT although PORT was used: %v", err)
			}
		})
	}
}

func TestLoad_LogLevel(t *testing.T) {
	tests := []struct {
		name    string
		level   *string
		want    string
		wantErr string
	}{
		{name: "unset defaults to info", level: nil, want: "info"},
		{name: "empty defaults to info", level: ptr(""), want: "info"},
		{name: "debug", level: ptr("debug"), want: "debug"},
		{name: "info", level: ptr("info"), want: "info"},
		{name: "warn", level: ptr("warn"), want: "warn"},
		{name: "error", level: ptr("error"), want: "error"},
		{name: "warning is not accepted", level: ptr("warning"), wantErr: `APP_LOG_LEVEL: must be debug, info, warn or error, got "warning"`},
		{name: "upper case is not accepted", level: ptr("DEBUG"), wantErr: `got "DEBUG"`},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{"APP_ENV": "staging"}
			if tt.level != nil {
				vars["APP_LOG_LEVEL"] = *tt.level
			}
			setEnv(t, vars)

			cfg, err := config.Load()
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.LogLevel, tt.want)
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestLoad_CORSAllowedOrigins(t *testing.T) {
	const shapeErr = "must be an origin like https://shop.example.com or http://localhost:5173"
	tests := []struct {
		name    string
		value   string
		want    []string
		wantErr []string
	}{
		{name: "empty means none", value: "", want: nil},
		{name: "only commas and spaces", value: " , ,", want: nil},
		{name: "one origin", value: "https://shop.example.com", want: []string{"https://shop.example.com"}},
		{
			name:  "trimmed and empty entries skipped",
			value: " http://localhost:5173 ,, https://admin.example.com:8443 ,",
			want:  []string{"http://localhost:5173", "https://admin.example.com:8443"},
		},
		{name: "wildcard refused", value: "*", wantErr: []string{`APP_CORS_ALLOWED_ORIGINS: "*" is not allowed: list each origin explicitly`}},
		{name: "wildcard among others refused", value: "https://a.example.com, *", wantErr: []string{`"*" is not allowed`}},
		{name: "no scheme", value: "shop.example.com", wantErr: []string{`"shop.example.com" ` + shapeErr}},
		{name: "ftp scheme", value: "ftp://shop.example.com", wantErr: []string{`"ftp://shop.example.com" ` + shapeErr}},
		{name: "no host", value: "https://", wantErr: []string{`"https://" ` + shapeErr}},
		{name: "path", value: "https://shop.example.com/app", wantErr: []string{`"https://shop.example.com/app" ` + shapeErr}},
		{name: "query", value: "https://shop.example.com?x=1", wantErr: []string{shapeErr}},
		{name: "fragment", value: "https://shop.example.com#top", wantErr: []string{shapeErr}},
		{name: "userinfo", value: "https://user@shop.example.com", wantErr: []string{shapeErr}},
		{name: "unparsable", value: "http://[::1", wantErr: []string{shapeErr}},
		{
			name:    "trailing slash",
			value:   "https://shop.example.com/",
			wantErr: []string{`"https://shop.example.com/" must not end with a slash: browsers send the origin without one`},
		},
		{
			name:    "every bad origin is reported",
			value:   "*, https://ok.example.com, https://x.example.com/",
			wantErr: []string{`"*" is not allowed`, `"https://x.example.com/" must not end with a slash`},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			setEnv(t, map[string]string{"APP_ENV": "development", "APP_CORS_ALLOWED_ORIGINS": tt.value})

			cfg, err := config.Load()
			if len(tt.wantErr) == 0 {
				testx.AssertNoError(t, err)
				if !reflect.DeepEqual(cfg.CORSAllowedOrigins, tt.want) {
					t.Errorf("CORSAllowedOrigins = %#v, want %#v", cfg.CORSAllowedOrigins, tt.want)
				}
				return
			}
			if err == nil {
				t.Fatalf("Load: want error, got nil (origins %#v)", cfg.CORSAllowedOrigins)
			}
			for _, want := range tt.wantErr {
				testx.AssertContains(t, err.Error(), want)
			}
			testx.AssertFalse(t, strings.Contains(err.Error(), `"https://ok.example.com"`), "a valid origin is reported as invalid: %v", err)
		})
	}
}

func TestLoad_Durations(t *testing.T) {
	tests := []struct {
		name    string
		vars    map[string]string
		check   func(t *testing.T, cfg config.Config)
		wantErr string
	}{
		{
			name: "all set",
			vars: map[string]string{"APP_REQUEST_TIMEOUT": "30s", "APP_DRAIN_DELAY": "5s", "APP_SHUTDOWN_TIMEOUT": "1m"},
			check: func(t *testing.T, cfg config.Config) {
				testx.AssertEqual(t, cfg.RequestTimeout, 30*time.Second)
				testx.AssertEqual(t, cfg.DrainDelay, 5*time.Second)
				testx.AssertEqual(t, cfg.ShutdownTimeout, time.Minute)
			},
		},
		{
			name: "lower bounds",
			vars: map[string]string{"APP_REQUEST_TIMEOUT": "1s", "APP_DRAIN_DELAY": "0s", "APP_SHUTDOWN_TIMEOUT": "1s"},
			check: func(t *testing.T, cfg config.Config) {
				testx.AssertEqual(t, cfg.RequestTimeout, time.Second)
				testx.AssertEqual(t, cfg.DrainDelay, time.Duration(0))
				testx.AssertEqual(t, cfg.ShutdownTimeout, time.Second)
			},
		},
		{
			name: "upper bounds",
			vars: map[string]string{"APP_REQUEST_TIMEOUT": "60s", "APP_DRAIN_DELAY": "60s", "APP_SHUTDOWN_TIMEOUT": "60s"},
			check: func(t *testing.T, cfg config.Config) {
				testx.AssertEqual(t, cfg.RequestTimeout, 60*time.Second)
				testx.AssertEqual(t, cfg.DrainDelay, 60*time.Second)
				testx.AssertEqual(t, cfg.ShutdownTimeout, 60*time.Second)
			},
		},
		{
			name:    "request timeout below 1s",
			vars:    map[string]string{"APP_REQUEST_TIMEOUT": "500ms"},
			wantErr: `APP_REQUEST_TIMEOUT: must be a duration between 1s and 1m0s, such as "15s", got "500ms"`,
		},
		{
			name:    "request timeout above 60s",
			vars:    map[string]string{"APP_REQUEST_TIMEOUT": "61s"},
			wantErr: `APP_REQUEST_TIMEOUT: must be a duration between 1s and 1m0s, such as "15s", got "61s"`,
		},
		{
			name:    "request timeout without unit",
			vars:    map[string]string{"APP_REQUEST_TIMEOUT": "15"},
			wantErr: `APP_REQUEST_TIMEOUT: must be a duration between 1s and 1m0s, such as "15s", got "15"`,
		},
		{
			name:    "drain delay negative",
			vars:    map[string]string{"APP_DRAIN_DELAY": "-1s"},
			wantErr: `APP_DRAIN_DELAY: must be a duration between 0s and 1m0s, such as "15s", got "-1s"`,
		},
		{
			name:    "drain delay above 60s",
			vars:    map[string]string{"APP_DRAIN_DELAY": "2m"},
			wantErr: `APP_DRAIN_DELAY: must be a duration between 0s and 1m0s`,
		},
		{
			name:    "shutdown timeout zero",
			vars:    map[string]string{"APP_SHUTDOWN_TIMEOUT": "0s"},
			wantErr: `APP_SHUTDOWN_TIMEOUT: must be a duration between 1s and 1m0s, such as "15s", got "0s"`,
		},
		{
			name:    "shutdown timeout above 60s",
			vars:    map[string]string{"APP_SHUTDOWN_TIMEOUT": "90s"},
			wantErr: `APP_SHUTDOWN_TIMEOUT: must be a duration between 1s and 1m0s`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{"APP_ENV": "production"}
			for k, v := range tt.vars {
				vars[k] = v
			}
			setEnv(t, vars)

			cfg, err := config.Load()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("Load: %v", err)
				}
				tt.check(t, cfg)
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
		})
	}
}

func TestLoad_ReportsEveryInvalidVariable(t *testing.T) {
	setEnv(t, map[string]string{
		"APP_ENV":                  "prod",
		"APP_LOG_LEVEL":            "verbose",
		"APP_PORT":                 "0",
		"APP_CORS_ALLOWED_ORIGINS": "*",
		"APP_REQUEST_TIMEOUT":      "0s",
		"APP_DRAIN_DELAY":          "-1s",
		"APP_SHUTDOWN_TIMEOUT":     "2m",
		"DATABASE_URL":             "",
		"APP_DB_MAX_OPEN_CONNS":    "0",
		"APP_DB_MAX_IDLE_CONNS":    "lots",
		"APP_DB_CONN_MAX_LIFETIME": "1s",
	})

	cfg, err := config.Load()
	if err == nil {
		t.Fatal("Load: want error, got nil")
	}
	msg := err.Error()
	for _, name := range []string{
		"APP_ENV:", "APP_LOG_LEVEL:", "APP_PORT:", "APP_CORS_ALLOWED_ORIGINS:",
		"APP_REQUEST_TIMEOUT:", "APP_DRAIN_DELAY:", "APP_SHUTDOWN_TIMEOUT:",
		"DATABASE_URL:", "APP_DB_MAX_OPEN_CONNS:", "APP_DB_MAX_IDLE_CONNS:", "APP_DB_CONN_MAX_LIFETIME:",
	} {
		testx.AssertContains(t, msg, name)
	}
	// One line per invalid variable (errors.Join), each named once: a bad
	// port must not also produce a second "port 0" error.
	testx.AssertEqual(t, strings.Count(msg, "\n"), 10, "lines in %q", msg)
	testx.AssertEqual(t, strings.Count(msg, "APP_PORT"), 1, "APP_PORT mentions in %q", msg)
	testx.AssertEqual(t, cfg.Port, 0, "a failed Load returns the zero Config")
	testx.AssertEqual(t, cfg.Env, "")
}

func TestConfig_IsDevelopment(t *testing.T) {
	tests := []struct {
		env  string
		want bool
	}{
		{config.EnvDevelopment, true},
		{config.EnvStaging, false},
		{config.EnvProduction, false},
		{"", false},
	}
	for _, tt := range tests {
		t.Run(tt.env, func(t *testing.T) {
			testx.AssertEqual(t, config.Config{Env: tt.env}.IsDevelopment(), tt.want)
		})
	}
}

func TestConfig_Addr(t *testing.T) {
	tests := []struct {
		port int
		want string
	}{
		{8080, ":8080"},
		{1, ":1"},
		{65535, ":65535"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			testx.AssertEqual(t, config.Config{Port: tt.port}.Addr(), tt.want)
		})
	}
}

func ptr(s string) *string { return &s }

func TestLoad_DatabaseURL(t *testing.T) {
	const shapeErr = "DATABASE_URL: must be a URL like postgres://"
	tests := []struct {
		name    string
		url     *string // nil: unset
		wantErr string
	}{
		{name: "postgres scheme", url: ptr("postgres://user:pass@db.internal:5432/goshop?sslmode=require")},
		{name: "postgresql scheme", url: ptr("postgresql://user:pass@db.internal/goshop")},
		{name: "no login", url: ptr("postgres://db.internal:5432/goshop")},
		{name: "unset is required", url: nil, wantErr: "DATABASE_URL: is required, e.g. postgres://"},
		{name: "empty is required", url: ptr(""), wantErr: "DATABASE_URL: is required"},
		{name: "other scheme", url: ptr("mysql://user:pass@db.internal:3306/goshop"), wantErr: shapeErr},
		{name: "no scheme", url: ptr("db.internal:5432/goshop"), wantErr: shapeErr},
		{name: "no host", url: ptr("postgres:///goshop"), wantErr: shapeErr},
		{name: "key=value DSN is not a URL", url: ptr("host=db.internal dbname=goshop"), wantErr: shapeErr},
		{name: "unparsable", url: ptr("postgres://user:pass@[::1/goshop"), wantErr: shapeErr},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{"APP_ENV": "production", "DATABASE_URL": ""}
			if tt.url != nil {
				vars["DATABASE_URL"] = *tt.url
			}
			setEnv(t, vars)
			if tt.url == nil {
				unsetEnv(t, "DATABASE_URL")
			}

			cfg, err := config.Load()
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Database.URL, *tt.url, "the URL is kept as given")
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			if tt.url != nil && *tt.url != "" {
				// The URL holds the password: no part of it may be echoed.
				testx.AssertFalse(t, strings.Contains(err.Error(), *tt.url), "error repeats the URL: %v", err)
				testx.AssertFalse(t, strings.Contains(err.Error(), "db.internal"), "error repeats the host: %v", err)
			}
		})
	}
}

func TestLoad_DatabasePool(t *testing.T) {
	tests := []struct {
		name      string
		vars      map[string]string
		wantOpen  int
		wantIdle  int
		wantLife  time.Duration
		wantErr   string
		wantNoErr []string // variables the error must not name
	}{
		{name: "defaults", wantOpen: 10, wantIdle: 5, wantLife: 30 * time.Minute},
		{
			name:     "all set",
			vars:     map[string]string{"APP_DB_MAX_OPEN_CONNS": "20", "APP_DB_MAX_IDLE_CONNS": "8", "APP_DB_CONN_MAX_LIFETIME": "1h"},
			wantOpen: 20, wantIdle: 8, wantLife: time.Hour,
		},
		{
			name:     "lower bounds",
			vars:     map[string]string{"APP_DB_MAX_OPEN_CONNS": "1", "APP_DB_MAX_IDLE_CONNS": "1", "APP_DB_CONN_MAX_LIFETIME": "1m"},
			wantOpen: 1, wantIdle: 1, wantLife: time.Minute,
		},
		{
			name:     "upper bounds",
			vars:     map[string]string{"APP_DB_MAX_OPEN_CONNS": "100", "APP_DB_MAX_IDLE_CONNS": "100", "APP_DB_CONN_MAX_LIFETIME": "24h"},
			wantOpen: 100, wantIdle: 100, wantLife: 24 * time.Hour,
		},
		{
			name:     "idle equal to open",
			vars:     map[string]string{"APP_DB_MAX_OPEN_CONNS": "5", "APP_DB_MAX_IDLE_CONNS": "5"},
			wantOpen: 5, wantIdle: 5, wantLife: 30 * time.Minute,
		},
		{
			name:    "open zero",
			vars:    map[string]string{"APP_DB_MAX_OPEN_CONNS": "0"},
			wantErr: `APP_DB_MAX_OPEN_CONNS: must be a number between 1 and 100, got "0"`,
			// The idle default (5) is not compared with an invalid max.
			wantNoErr: []string{"APP_DB_MAX_IDLE_CONNS"},
		},
		{name: "open above 100", vars: map[string]string{"APP_DB_MAX_OPEN_CONNS": "101"}, wantErr: `APP_DB_MAX_OPEN_CONNS: must be a number between 1 and 100, got "101"`},
		{name: "open not a number", vars: map[string]string{"APP_DB_MAX_OPEN_CONNS": "ten"}, wantErr: `APP_DB_MAX_OPEN_CONNS: must be a number between 1 and 100, got "ten"`},
		{name: "idle zero", vars: map[string]string{"APP_DB_MAX_IDLE_CONNS": "0"}, wantErr: `APP_DB_MAX_IDLE_CONNS: must be a number between 1 and 100, got "0"`},
		{name: "idle above 100", vars: map[string]string{"APP_DB_MAX_IDLE_CONNS": "101"}, wantErr: `APP_DB_MAX_IDLE_CONNS: must be a number between 1 and 100, got "101"`},
		{
			name:    "idle above open",
			vars:    map[string]string{"APP_DB_MAX_OPEN_CONNS": "4", "APP_DB_MAX_IDLE_CONNS": "5"},
			wantErr: "APP_DB_MAX_IDLE_CONNS: must not be above APP_DB_MAX_OPEN_CONNS (4), got 5",
		},
		{
			name:    "idle default above a small open",
			vars:    map[string]string{"APP_DB_MAX_OPEN_CONNS": "2"},
			wantErr: "APP_DB_MAX_IDLE_CONNS: must not be above APP_DB_MAX_OPEN_CONNS (2), got 5",
		},
		{
			name:    "lifetime below 1m",
			vars:    map[string]string{"APP_DB_CONN_MAX_LIFETIME": "59s"},
			wantErr: `APP_DB_CONN_MAX_LIFETIME: must be a duration between 1m0s and 24h0m0s, such as "15s", got "59s"`,
		},
		{
			name:    "lifetime above 24h",
			vars:    map[string]string{"APP_DB_CONN_MAX_LIFETIME": "25h"},
			wantErr: `APP_DB_CONN_MAX_LIFETIME: must be a duration between 1m0s and 24h0m0s`,
		},
		{
			name:    "lifetime without unit",
			vars:    map[string]string{"APP_DB_CONN_MAX_LIFETIME": "30"},
			wantErr: `APP_DB_CONN_MAX_LIFETIME: must be a duration between 1m0s and 24h0m0s, such as "15s", got "30"`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			vars := map[string]string{"APP_ENV": "production"}
			for k, v := range tt.vars {
				vars[k] = v
			}
			setEnv(t, vars)

			cfg, err := config.Load()
			if tt.wantErr == "" {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.Database.MaxOpenConns, tt.wantOpen)
				testx.AssertEqual(t, cfg.Database.MaxIdleConns, tt.wantIdle)
				testx.AssertEqual(t, cfg.Database.ConnMaxLifetime, tt.wantLife)
				return
			}
			if err == nil {
				t.Fatalf("Load: want error containing %q, got nil", tt.wantErr)
			}
			testx.AssertContains(t, err.Error(), tt.wantErr)
			for _, name := range tt.wantNoErr {
				testx.AssertFalse(t, strings.Contains(err.Error(), name), "error names %s: %v", name, err)
			}
		})
	}
}
