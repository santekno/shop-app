// Package database opens the PostgreSQL connection pool and applies the
// migrations. The rest of the API only sees a *sql.DB.
package database

import (
	"context"
	"database/sql"
	"fmt"
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
// driver, and pings the database once: the API refuses to start without it.
// The caller closes the pool.
func Open(ctx context.Context, cfg config.Database, logger logx.Logger) (*sql.DB, error) {
	ctx, cancel := context.WithTimeout(ctx, connectTimeout)
	defer cancel()

	db, err := sqlx.Open(ctx, sqlx.Config{
		Driver: "pgx",
		DSN:    cfg.URL,
		Logger: logger,
	})
	if err != nil {
		return nil, fmt.Errorf("open database: %w", err)
	}
	return db.DB, nil
}
