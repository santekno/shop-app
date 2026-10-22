// Package database opens the PostgreSQL connection pool and applies the
// migrations. The rest of the API only sees a *sql.DB.
package database

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"time"

	// Registers the "pgx" driver for database/sql.
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/sqlx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

// connectTimeout bounds the first connection, so a wrong host fails the
// start in seconds instead of hanging until the OS gives up.
const connectTimeout = 10 * time.Second

// Open opens a connection pool to cfg.URL through sdk sqlx with the pgx
// driver, sized by cfg, and pings the database once: the API refuses to
// start without it. The caller closes the pool.
//
// A *sql.DB is a pool, not one connection: it is safe for concurrent use,
// opens connections when requests need them (up to MaxOpenConns), keeps up
// to MaxIdleConns of them for reuse, and replaces any older than
// ConnMaxLifetime. Open it once at start and share it.
func Open(ctx context.Context, cfg config.Database, logger logx.Logger) (*sql.DB, error) {
	dsn, err := withCustomPlans(cfg.URL)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	db, err := sqlx.Open(ctx, sqlx.Config{
		Driver:          "pgx",
		DSN:             dsn,
		MaxOpenConns:    cfg.MaxOpenConns,
		MaxIdleConns:    cfg.MaxIdleConns,
		ConnMaxLifetime: cfg.ConnMaxLifetime,
		Logger:          logger,
	})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	warnIfNotCustomPlans(ctx, db.DB, logger)
	return db.DB, nil
}

// warnIfNotCustomPlans logs a warning when the session did not get
// plan_cache_mode=force_custom_plan, for example behind a pooler such as
// PgBouncer in transaction mode, which drops startup parameters. The API
// still works; catalog searches may get slow generic plans. The fix on the
// server side: ALTER ROLE <user> SET plan_cache_mode = force_custom_plan.
func warnIfNotCustomPlans(ctx context.Context, db *sql.DB, logger logx.Logger) {
	var mode string
	if err := db.QueryRowContext(ctx, "SHOW plan_cache_mode").Scan(&mode); err != nil {
		logger.Warn("could not read plan_cache_mode", "error", err.Error())
		return
	}
	if mode != "force_custom_plan" {
		logger.Warn("plan_cache_mode is not force_custom_plan; catalog searches may get slow generic plans",
			"plan_cache_mode", mode, "fix", "ALTER ROLE <user> SET plan_cache_mode = force_custom_plan")
	}
}

// withCustomPlans adds plan_cache_mode=force_custom_plan to the connection
// URL, unless it already sets plan_cache_mode; pgx sends parameters it does
// not know itself to Postgres as session settings.
//
// The catalog queries have optional filters ($1 IS NULL OR ...). pgx
// prepares every statement, and after five runs Postgres may switch a
// prepared statement to one generic plan for all values, which cannot drop
// the unused filter: a search with no hits then scans every active product
// instead of the search index (docs/explain/catalog.md). A custom plan per
// run costs well under a millisecond of planning.
func withCustomPlans(databaseURL string) (string, error) {
	u, err := url.Parse(databaseURL)
	if err != nil {
		// url's error repeats the URL, which holds the password.
		return "", errors.New("open database: DATABASE_URL is not a valid URL")
	}
	q := u.Query()
	if q.Get("plan_cache_mode") == "" {
		q.Set("plan_cache_mode", "force_custom_plan")
	}
	u.RawQuery = q.Encode()
	return u.String(), nil
}
