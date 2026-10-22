package database

import (
	"database/sql"
	"errors"
	"fmt"

	"github.com/golang-migrate/migrate/v4"
	pgxmigrate "github.com/golang-migrate/migrate/v4/database/pgx/v5"
	"github.com/golang-migrate/migrate/v4/source/iofs"

	"github.com/santekno/shop-app/apps/api/migrations"
)

// Migrate applies every embedded migration that db has not run yet and
// returns the schema version it ends at. It only goes up: rolling back is a
// developer action (make migrate-down), never part of a deploy.
//
// golang-migrate records the version in the schema_migrations table, the
// same table the migrate CLI behind make migrate-up uses, and holds a
// Postgres advisory lock while it runs, so two deploys cannot migrate at
// once. Migrate takes over db and closes it when done.
func Migrate(db *sql.DB) (version uint, err error) {
	src, err := iofs.New(migrations.FS, ".")
	if err != nil {
		_ = db.Close()
		return 0, fmt.Errorf("read migrations: %w", err)
	}
	driver, err := pgxmigrate.WithInstance(db, &pgxmigrate.Config{})
	if err != nil {
		_ = db.Close()
		return 0, fmt.Errorf("prepare migrations: %w", err)
	}
	m, err := migrate.NewWithInstance("iofs", src, "pgx5", driver)
	if err != nil {
		_ = driver.Close()
		return 0, fmt.Errorf("prepare migrations: %w", err)
	}
	// Closes the source and the driver, which closes db.
	defer func() {
		srcErr, dbErr := m.Close()
		if err == nil {
			err = errors.Join(srcErr, dbErr)
		}
	}()

	if err := m.Up(); err != nil && !errors.Is(err, migrate.ErrNoChange) {
		return 0, fmt.Errorf("apply migrations: %w", err)
	}
	version, _, err = m.Version()
	if err != nil {
		return 0, fmt.Errorf("read schema version: %w", err)
	}
	return version, nil
}
