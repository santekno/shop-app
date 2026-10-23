package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
)

// loadTestPasswordEnv holds the password every load-test buyer gets. Read
// from the environment, like the admin's, never from a flag.
const loadTestPasswordEnv = "SEED_LOADTEST_PASSWORD" // #nosec G101 -- the variable's name, not a password

// The load-test data (artikel 14, make seed-loadtest): buyers named
// loadtest-0001@goshop.local …, each verified and with one default
// address, and one active product with two variants: plenty of stock for
// throughput, and a few units that many buyers race for, to show that no
// order oversells.
const (
	loadTestEmailFormat = "loadtest-%04d@goshop.local"
	loadTestProductSlug = "loadtest-kaos"
	// LOADTEST-PLENTY never runs out during a run.
	loadTestPlentySKU   = "LOADTEST-PLENTY"
	loadTestPlentyStock = 1_000_000
	// LOADTEST-SCARCE: exactly this many units can be sold per run.
	loadTestScarceSKU   = "LOADTEST-SCARCE"
	loadTestScarceStock = 10
	maxLoadTestUsers    = 1000
)

var loadTestProduct = seedProduct{
	category: "kaos", slug: loadTestProductSlug, name: "Kaos Load Test",
	description: "Produk untuk load test checkout (make seed-loadtest); bukan barang sungguhan.",
	variants: []seedVariant{
		{loadTestPlentySKU, "Plenty", 50000, loadTestPlentyStock, 200, false},
		{loadTestScarceSKU, "Scarce", 50000, loadTestScarceStock, 200, false},
	},
}

// runLoadTest seeds users load-test buyers and the load-test product, and
// resets the run's state: both variants back to their stock, and the
// load-test buyers' unpaid orders cancelled (directly in SQL, without
// restoring stock, which is reset anyway), so each run starts the same.
// Run make seed first: the product needs the kaos category.
func runLoadTest(ctx context.Context, databaseURL string, users int, password string) error {
	if users < 1 || users > maxLoadTestUsers {
		return fmt.Errorf("-loadtest must be between 1 and %d, got %d", maxLoadTestUsers, users)
	}
	if password == "" {
		return errors.New(loadTestPasswordEnv + " is not set (make seed-loadtest needs it)")
	}
	if err := auth.CheckPassword(password); err != nil {
		return fmt.Errorf("%s: %w", loadTestPasswordEnv, err)
	}
	db, err := database.Open(ctx, config.Database{URL: databaseURL}, logx.Noop())
	if err != nil {
		return err
	}
	defer func() { _ = db.Close() }()

	categoryIDs, err := seedCategories(ctx, db)
	if err != nil {
		return fmt.Errorf("categories (did you run make migrate-up?): %w", err)
	}
	if _, err := insertProduct(ctx, db, categoryIDs[loadTestProduct.category], loadTestProduct, "active", time.Time{}); err != nil {
		return err
	}
	// One argon2id hash for every buyer: hashing a thousand passwords
	// would take minutes and 64 MiB each.
	hash, err := auth.NewArgon2Hasher(1).Hash(ctx, password)
	if err != nil {
		return err
	}
	added := 0
	for i := 1; i <= users; i++ {
		isNew, err := seedLoadTestUser(ctx, db, fmt.Sprintf(loadTestEmailFormat, i), hash)
		if err != nil {
			return err
		}
		if isNew {
			added++
		}
	}
	if err := resetLoadTest(ctx, db); err != nil {
		return err
	}
	fmt.Printf("load test: %d buyers (%d new, %s to %s), product %s: %s stock %d, %s stock %d\n",
		users, added, fmt.Sprintf(loadTestEmailFormat, 1), fmt.Sprintf(loadTestEmailFormat, users),
		loadTestProductSlug, loadTestPlentySKU, loadTestPlentyStock, loadTestScarceSKU, loadTestScarceStock)
	return nil
}

// seedLoadTestUser creates a verified buyer with a default address. A
// buyer that exists already gets hash as its password, so a run with
// another SEED_LOADTEST_PASSWORD works; only loadtest-* accounts are ever
// touched. It reports whether the buyer is new.
func seedLoadTestUser(ctx context.Context, db *sql.DB, email, hash string) (bool, error) {
	id := uuidx.NewV7()
	var inserted bool
	err := db.QueryRowContext(ctx, `
		INSERT INTO users (id, email, password_hash, name, role, email_verified_at)
		VALUES ($1, $2, $3, 'Load Test', 'buyer', now())
		ON CONFLICT (email) DO UPDATE
		SET password_hash = EXCLUDED.password_hash, updated_at = now()
		WHERE users.email LIKE 'loadtest-%@goshop.local' AND users.anonymized_at IS NULL
		RETURNING xmax = 0`, id, email, hash).Scan(&inserted)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil // not a load-test account we may change
	}
	if err != nil {
		return false, fmt.Errorf("upsert %s: %w", email, err)
	}
	if !inserted {
		return false, nil
	}
	_, err = db.ExecContext(ctx, `
		INSERT INTO addresses (id, user_id, label, recipient_name, phone, street, city, province, postal_code, is_default)
		VALUES ($1, $2, 'Rumah', 'Load Test', '081234567890', 'Jl. Uji Beban No. 1', 'Bandung', 'Jawa Barat', '40111', true)`,
		uuidx.NewV7(), id)
	if err != nil {
		return false, fmt.Errorf("insert address of %s: %w", email, err)
	}
	return true, nil
}

// resetLoadTest puts the load-test variants back to their stock and
// cancels the load-test buyers' unpaid orders, in one transaction.
func resetLoadTest(ctx context.Context, db *sql.DB) error {
	return withSeedTx(ctx, db, func(tx *sql.Tx) error {
		_, err := tx.ExecContext(ctx, `
			UPDATE orders SET status = 'cancelled', cancel_reason = 'seller_cancelled', cancelled_at = now(), updated_at = now()
			WHERE status = 'pending_payment'
			  AND user_id IN (SELECT id FROM users WHERE email LIKE 'loadtest-%@goshop.local')`)
		if err != nil {
			return fmt.Errorf("cancel load-test orders: %w", err)
		}
		_, err = tx.ExecContext(ctx, `
			UPDATE product_variants
			SET stock = CASE sku WHEN $1 THEN $2::integer ELSE $3::integer END,
			    version = version + 1, updated_at = now()
			WHERE sku IN ($1, $4)`,
			loadTestPlentySKU, loadTestPlentyStock, loadTestScarceStock, loadTestScarceSKU)
		if err != nil {
			return fmt.Errorf("reset load-test stock: %w", err)
		}
		return nil
	})
}

func withSeedTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }() // a no-op after Commit
	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit: %w", err)
	}
	return nil
}
