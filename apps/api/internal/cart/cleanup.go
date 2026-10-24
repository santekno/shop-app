package cart

import (
	"context"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// GuestCartTTL is how long a guest cart nobody touches is kept (ADR
// 0007): a guest who comes back within 30 days still finds it.
const GuestCartTTL = 30 * 24 * time.Hour

// cleanupBatchSize is how many guest carts one DELETE takes, so a big
// backlog never becomes one long transaction.
const cleanupBatchSize = 500

// DeleteAbandonedGuestCarts deletes every guest cart, with its lines, that
// nobody has touched since GuestCartTTL before now, in batches, and returns
// how many. A cart in use right now is skipped. The worker runs it hourly.
func (r *PostgresRepository) DeleteAbandonedGuestCarts(ctx context.Context, now time.Time) (int64, error) {
	var total int64
	for {
		n, err := r.q.DeleteAbandonedGuestCarts(ctx, sqlc.DeleteAbandonedGuestCartsParams{
			Before: now.Add(-GuestCartTTL), BatchSize: cleanupBatchSize,
		})
		total += n
		if err != nil {
			return total, fmt.Errorf("delete abandoned guest carts: %w", err)
		}
		if n < cleanupBatchSize {
			return total, nil
		}
	}
}
