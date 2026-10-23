package order

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Idempotency of POST /v1/checkout (ADR 0006).
const (
	// IdempotencyTTL is how long a key is remembered.
	IdempotencyTTL = 24 * time.Hour
	// IdempotencyStaleAfter is when a key whose request never finished
	// (the process died) may be claimed again: longer than any request
	// may run (APP_REQUEST_TIMEOUT is at most 60s).
	IdempotencyStaleAfter = 2 * time.Minute
)

// Errors of the Idempotency-Key header.
var (
	// ErrIdempotencyKeyReused: the key was used for a different request
	// body. 422: the request is well-formed but cannot be processed under
	// that key.
	ErrIdempotencyKeyReused = errors.New("idempotency key reused with another request")
	// ErrIdempotencyInProgress: the first request with this key is still
	// running. 409; retry in a moment.
	ErrIdempotencyInProgress = errors.New("idempotency key in progress")
)

// Idempotency is a checkout's Idempotency-Key and the SHA-256 of its body.
type Idempotency struct {
	Key         string
	RequestHash []byte
}

// RequestHash is the SHA-256 of body re-encoded as JSON, so the same
// request with other whitespace or key order hashes the same.
func RequestHash(body any) ([]byte, error) {
	b, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("hash request: %w", err)
	}
	sum := sha256.Sum256(b)
	return sum[:], nil
}

// Response is what POST /v1/checkout answers: the stored bytes of the
// first answer, so a replay is identical to it.
type Response struct {
	Status  int
	Body    []byte
	OrderID string
	// Replayed is true when this is the stored answer of an earlier
	// request with the same key.
	Replayed bool
}

// claimResult is what claiming a key found.
type claimResult struct {
	// claimed: the key is ours; run the checkout.
	claimed bool
	// claimID names this claim; saving the answer and releasing the key
	// must match it.
	claimID string
	// replay is the stored answer of a finished request with the same
	// body.
	replay *Response
}

// ClaimKey claims key for userID before the checkout runs. It returns
// claimed, a replay of the finished request with the same body,
// ErrIdempotencyKeyReused for a different body, ErrIdempotencyInProgress
// while the first request still runs, or ErrAccountGone.
func (r *PostgresRepository) ClaimKey(ctx context.Context, userID string, idem Idempotency, now time.Time) (claimResult, error) {
	claimID := uuidx.NewV7()
	_, err := r.q.ClaimIdempotencyKey(ctx, sqlc.ClaimIdempotencyKeyParams{
		UserID: userID, Key: idem.Key, RequestHash: idem.RequestHash, ClaimID: claimID, Now: now,
		ExpiresAt: now.Add(IdempotencyTTL), StaleBefore: now.Add(-IdempotencyStaleAfter),
	})
	if err == nil {
		return claimResult{claimed: true, claimID: claimID}, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return claimResult{}, fmt.Errorf("claim idempotency key: %w", err)
	}
	row, err := r.q.GetIdempotencyKey(ctx, sqlc.GetIdempotencyKeyParams{UserID: userID, Key: idem.Key})
	if errors.Is(err, sql.ErrNoRows) {
		// Nothing was claimed and there is no key: the account was
		// deleted, or the key was released between the two statements
		// (a failed first request), and the client may simply retry.
		_, err := r.q.GetUserByID(ctx, userID)
		switch {
		case errors.Is(err, sql.ErrNoRows):
			return claimResult{}, ErrAccountGone
		case err != nil:
			return claimResult{}, fmt.Errorf("read idempotency key owner: %w", err)
		}
		return claimResult{}, ErrIdempotencyInProgress
	}
	if err != nil {
		return claimResult{}, fmt.Errorf("read idempotency key: %w", err)
	}
	switch {
	case !bytes.Equal(row.RequestHash, idem.RequestHash):
		return claimResult{}, ErrIdempotencyKeyReused
	case !row.ResponseStatus.Valid:
		return claimResult{}, ErrIdempotencyInProgress
	}
	replay := &Response{Status: int(row.ResponseStatus.Int16), Body: []byte(row.ResponseBody), Replayed: true}
	if row.OrderID != nil {
		replay.OrderID = *row.OrderID
	}
	return claimResult{replay: replay}, nil
}

// ReleaseKey frees the claim claimID of a key whose checkout failed, so the
// same key can be retried once the buyer has fixed the problem. A claim
// taken over by a newer request is left alone.
func (r *PostgresRepository) ReleaseKey(ctx context.Context, userID, key, claimID string) error {
	err := r.q.ReleaseIdempotencyKey(ctx, sqlc.ReleaseIdempotencyKeyParams{UserID: userID, Key: key, ClaimID: claimID})
	if err != nil {
		return fmt.Errorf("release idempotency key: %w", err)
	}
	return nil
}

// DeleteExpiredKeys deletes up to limit keys that expired before now and
// returns how many.
func (r *PostgresRepository) DeleteExpiredKeys(ctx context.Context, now time.Time, limit int32) (int64, error) {
	n, err := r.q.DeleteExpiredIdempotencyKeys(ctx, sqlc.DeleteExpiredIdempotencyKeysParams{Now: now, BatchSize: limit})
	if err != nil {
		return 0, fmt.Errorf("delete expired idempotency keys: %w", err)
	}
	return n, nil
}

// saveResponse stores the checkout's answer in its key, inside the
// checkout's transaction, so the order and the answer commit together.
func saveResponse(ctx context.Context, q *sqlc.Queries, userID, key, claimID string, resp Response) error {
	n, err := q.SaveIdempotencyResponse(ctx, sqlc.SaveIdempotencyResponseParams{
		UserID: userID, Key: key, ClaimID: claimID, ResponseStatus: int16(resp.Status), // #nosec G115 -- an HTTP status
		ResponseBody: resp.Body, OrderID: resp.OrderID,
	})
	if err != nil {
		return fmt.Errorf("save idempotent response: %w", err)
	}
	if n == 0 {
		// The key was taken over as stale while this request ran past
		// IdempotencyStaleAfter: roll back rather than risk two orders.
		return ErrIdempotencyInProgress
	}
	return nil
}

// encodeResponse is v as the API writes JSON (httpapi.JSON): no HTML
// escaping, one trailing newline.
func encodeResponse(v any) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, fmt.Errorf("encode response: %w", err)
	}
	return buf.Bytes(), nil
}

// KeyCleanupBatch is how many expired keys one cleanup statement deletes.
const KeyCleanupBatch = 1000

// CleanupKeys deletes every expired idempotency key, in batches, and
// returns how many. `api cleanup-idempotency-keys` runs it once.
func (s *Service) CleanupKeys(ctx context.Context) (int64, error) {
	now := s.now()
	var total int64
	for {
		n, err := s.repo.DeleteExpiredKeys(ctx, now, KeyCleanupBatch)
		total += n
		if err != nil || n < KeyCleanupBatch {
			return total, err
		}
	}
}
