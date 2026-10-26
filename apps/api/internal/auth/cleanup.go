package auth

import (
	"context"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// refreshCleanupBatchSize is how many expired refresh tokens one DELETE
// takes (ADR 0005: in batches, so a session's family never makes one long
// transaction).
const refreshCleanupBatchSize = 1000

// DeleteExpiredRefreshTokens deletes every refresh token past its expiry
// at now, in batches, and returns how many. No request can use an expired
// token, rotated or not. The worker runs it hourly.
func (r *PostgresRepository) DeleteExpiredRefreshTokens(ctx context.Context, now time.Time) (int64, error) {
	var total int64
	for {
		n, err := r.q.DeleteExpiredRefreshTokens(ctx, sqlc.DeleteExpiredRefreshTokensParams{
			Before: now, BatchSize: refreshCleanupBatchSize,
		})
		total += n
		if err != nil {
			return total, fmt.Errorf("delete expired refresh tokens: %w", err)
		}
		if n < refreshCleanupBatchSize {
			return total, nil
		}
	}
}
