package order

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

var testHash = bytes.Repeat([]byte{7}, 32)

func claim(t *testing.T, db *fakeSQL) (claimResult, error) {
	t.Helper()
	return NewPostgresRepository(db.open(t)).ClaimKey(context.Background(), buyerID, Idempotency{Key: "key-1", RequestHash: testHash}, testTime)
}

func TestPostgresRepository_ClaimKey(t *testing.T) {
	t.Run("a new key is claimed under a fresh claim id", func(t *testing.T) {
		db := newFakeSQL().on("ClaimIdempotencyKey", rows(buyerID))
		got, err := claim(t, db)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, got.claimed)
		testx.AssertTrue(t, got.replay == nil)
		testx.AssertTrue(t, uuidx.IsValidUUID(got.claimID), "claim id %q", got.claimID)
		c, _ := db.call("ClaimIdempotencyKey")
		assertArgs(t, c.args, []driver.Value{
			"key-1", testHash, got.claimID, testTime, testTime.Add(IdempotencyTTL),
			buyerID, testTime.Add(-IdempotencyStaleAfter),
		}, "24 hours to live; a request older than 2 minutes without an answer is stale")
		// Only for an account that exists, read FOR KEY SHARE so a claim
		// that meets an account deletion waits for it.
		assertSQL(t, db, "ClaimIdempotencyKey", "WHERE u.id = $6 AND u.anonymized_at IS NULL FOR KEY SHARE")
		testx.AssertFalse(t, db.ran("GetIdempotencyKey"))

		again, _ := claim(t, newFakeSQL().on("ClaimIdempotencyKey", rows(buyerID)))
		testx.AssertNotEqual(t, again.claimID, got.claimID, "every claim has its own id")
	})

	stored := func(hash []byte, status, body, order driver.Value) fakeAnswer {
		return rows(hash, status, body, order)
	}
	tests := []struct {
		name  string
		row   fakeAnswer
		check func(t *testing.T, got claimResult, err error)
	}{
		{name: "a finished request with the same body is replayed", row: stored(testHash, int64(201), `{"data":{}}`, orderID1),
			check: func(t *testing.T, got claimResult, err error) {
				testx.AssertNoError(t, err)
				testx.AssertFalse(t, got.claimed)
				testx.AssertEqual(t, got.claimID, "", "a replay holds no claim")
				if got.replay == nil {
					t.Fatal("no replay")
				}
				testx.AssertEqual(t, got.replay.Status, 201)
				testx.AssertEqual(t, string(got.replay.Body), `{"data":{}}`)
				testx.AssertEqual(t, got.replay.OrderID, orderID1)
				testx.AssertTrue(t, got.replay.Replayed)
			}},
		{name: "a replay without an order id", row: stored(testHash, int64(201), `{}`, nil),
			check: func(t *testing.T, got claimResult, err error) {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, got.replay.OrderID, "")
			}},
		{name: "another body under the same key is 422", row: stored(bytes.Repeat([]byte{8}, 32), int64(201), `{}`, orderID1),
			check: func(t *testing.T, _ claimResult, err error) {
				testx.AssertTrue(t, errors.Is(err, ErrIdempotencyKeyReused))
			}},
		{name: "another body while the first still runs is 422 too", row: stored(bytes.Repeat([]byte{8}, 32), nil, "", nil),
			check: func(t *testing.T, _ claimResult, err error) {
				testx.AssertTrue(t, errors.Is(err, ErrIdempotencyKeyReused))
			}},
		{name: "the same body while the first still runs is 409", row: stored(testHash, nil, "", nil),
			check: func(t *testing.T, _ claimResult, err error) {
				testx.AssertTrue(t, errors.Is(err, ErrIdempotencyInProgress))
			}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL().on("GetIdempotencyKey", tt.row) // the claim returns no row: the key is taken
			got, err := claim(t, db)
			tt.check(t, got, err)
			c, _ := db.call("GetIdempotencyKey")
			assertArgs(t, c.args, []driver.Value{buyerID, "key-1"})
		})
	}
	t.Run("errors", func(t *testing.T) {
		_, err := claim(t, newFakeSQL().on("ClaimIdempotencyKey", failWith(errBoom)))
		testx.AssertEqual(t, err.Error(), "claim idempotency key: boom")
		_, err = claim(t, newFakeSQL().on("GetIdempotencyKey", failWith(errBoom)))
		testx.AssertEqual(t, err.Error(), "read idempotency key: boom")
	})
}

func TestPostgresRepository_ReleaseKey(t *testing.T) {
	db := newFakeSQL()
	testx.AssertNoError(t, NewPostgresRepository(db.open(t)).ReleaseKey(context.Background(), buyerID, "key-1", "claim-1"))
	c, _ := db.call("ReleaseIdempotencyKey")
	assertArgs(t, c.args, []driver.Value{buyerID, "key-1", "claim-1"}, "only this request's claim is freed")
	assertSQL(t, db, "ReleaseIdempotencyKey", "AND claim_id = $3 AND response_status IS NULL")

	err := NewPostgresRepository(newFakeSQL().on("ReleaseIdempotencyKey", failWith(errBoom)).open(t)).ReleaseKey(context.Background(), buyerID, "k", "c")
	testx.AssertEqual(t, err.Error(), "release idempotency key: boom")
}

func TestPostgresRepository_DeleteExpiredKeys(t *testing.T) {
	db := newFakeSQL().on("DeleteExpiredIdempotencyKeys", fakeAnswer{affected: 42})
	n, err := NewPostgresRepository(db.open(t)).DeleteExpiredKeys(context.Background(), testTime, KeyCleanupBatch)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(42))
	c, _ := db.call("DeleteExpiredIdempotencyKeys")
	assertArgs(t, c.args, []driver.Value{testTime, int64(KeyCleanupBatch)})
	// The outer recheck: a key claimed again while the DELETE waited for
	// its row is kept.
	assertSQL(t, db, "DeleteExpiredIdempotencyKeys", ") AND expires_at < $1")

	_, err = NewPostgresRepository(newFakeSQL().on("DeleteExpiredIdempotencyKeys", failWith(errBoom)).open(t)).DeleteExpiredKeys(context.Background(), testTime, 1)
	testx.AssertEqual(t, err.Error(), "delete expired idempotency keys: boom")
}

// The claim id goes from ClaimKey to Place (the save) and to ReleaseKey.
func TestService_CheckoutCarriesTheClaim(t *testing.T) {
	env := newServiceEnv(line(v1, 1, 1000, 5))
	env.repo.claim = claimResult{claimed: true, claimID: "claim-7"}
	_, err := env.svc.Checkout(context.Background(), buyerID, Idempotency{Key: "k"}, checkoutIn())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, env.repo.placed[0].IdempotencyClaim, "claim-7")
	testx.AssertEqual(t, env.repo.placed[0].IdempotencyKey, "k")

	env = newServiceEnv() // an empty cart fails
	env.repo.claim = claimResult{claimed: true, claimID: "claim-8"}
	_, err = env.svc.Checkout(context.Background(), buyerID, Idempotency{Key: "k"}, checkoutIn())
	testx.AssertTrue(t, errors.Is(err, ErrCartEmpty))
	testx.AssertEqual(t, len(env.repo.releasedClaims), 1)
	testx.AssertEqual(t, env.repo.releasedClaims[0], "claim-8")
}

func TestRequestHash(t *testing.T) {
	a, err := RequestHash(checkoutBody{AddressID: addressID, Courier: "jne", Service: "REG", VoucherCode: "HEMAT10"})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(a), 32)
	b, _ := RequestHash(checkoutBody{AddressID: addressID, Courier: "jne", Service: "REG", VoucherCode: "HEMAT10"})
	testx.AssertTrue(t, bytes.Equal(a, b), "stable")
	c, _ := RequestHash(checkoutBody{AddressID: addressID, Courier: "jne", Service: "YES", VoucherCode: "HEMAT10"})
	testx.AssertFalse(t, bytes.Equal(a, c), "another body, another hash")
	// A fixed value: a change of encoding would make every stored key a
	// different request (422 on a legitimate retry).
	m, _ := RequestHash(map[string]string{"a": "b"})
	testx.AssertEqual(t, hex.EncodeToString(m), "db4a7ecb114bc66c623a06c4ff6fe8daa2f49cc270ebbf7a1f81e22ab061c837", `SHA-256 of {"a":"b"}`)

	_, err = RequestHash(make(chan int))
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "hash request: ")
}

func TestEncodeResponse(t *testing.T) {
	b, err := encodeResponse(map[string]string{"url": "/v1/orders?a=1&b=<2>"})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, string(b), "{\"url\":\"/v1/orders?a=1&b=<2>\"}\n", "no HTML escaping, one newline, like httpapi.JSON")
	_, err = encodeResponse(make(chan int))
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "encode response: ")
}

// Nothing claimed and no key: either the first request was released
// between the two statements (409, retry) or the account is gone (401).
func TestPostgresRepository_ClaimKeyWithoutAKey(t *testing.T) {
	userRow := rows(buyerID, "budi@example.com", nil, "Budi", nil, "buyer", testTime, testTime, testTime)
	t.Run("released meanwhile: retry", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", userRow)
		_, err := claim(t, db)
		testx.AssertTrue(t, errors.Is(err, ErrIdempotencyInProgress), "err = %v", err)
		c, _ := db.call("GetUserByID")
		assertArgs(t, c.args, []driver.Value{buyerID})
	})
	t.Run("the account was deleted", func(t *testing.T) {
		db := newFakeSQL()
		_, err := claim(t, db)
		testx.AssertTrue(t, errors.Is(err, ErrAccountGone), "err = %v", err)
		testx.AssertTrue(t, db.ran("GetUserByID"))
	})
	t.Run("the owner lookup fails: an error, not a retry or a 401", func(t *testing.T) {
		db := newFakeSQL().on("GetUserByID", failWith(errBoom))
		_, err := claim(t, db)
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "read idempotency key owner: boom")
		testx.AssertFalse(t, errors.Is(err, ErrIdempotencyInProgress), "a database failure is not a request in flight")
		testx.AssertFalse(t, errors.Is(err, ErrAccountGone))
		// The handler answers it 500, with nothing of the cause.
		rec := httptest.NewRecorder()
		httpapi.Error(rec, httptest.NewRequestWithContext(context.Background(), http.MethodPost, "/v1/checkout", nil), toHTTPError(err))
		assertError(t, rec, http.StatusInternalServerError, httpapi.CodeInternal)
		testx.AssertFalse(t, strings.Contains(rec.Body.String(), "boom"))
	})
	t.Run("a key that exists needs no user check", func(t *testing.T) {
		db := newFakeSQL().on("GetIdempotencyKey", rows(testHash, nil, "", nil))
		_, err := claim(t, db)
		testx.AssertTrue(t, errors.Is(err, ErrIdempotencyInProgress))
		testx.AssertFalse(t, db.ran("GetUserByID"))
	})
}
