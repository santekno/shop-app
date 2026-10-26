package auth

// Bab 6 artikel 07: the worker's hourly cleanup of expired refresh tokens.

import (
	"database/sql/driver"
	"errors"
	"reflect"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// refreshCleanupCalls is every DeleteExpiredRefreshTokens the repository ran.
func refreshCleanupCalls(db *fakeSQL) []fakeCall {
	db.mu.Lock()
	defer db.mu.Unlock()
	var out []fakeCall
	for _, c := range db.calls {
		if c.name == "DeleteExpiredRefreshTokens" {
			out = append(out, c)
		}
	}
	return out
}

func TestDeleteExpiredRefreshTokens(t *testing.T) {
	now := time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)
	deleted := func(n int64) fakeAnswer { return fakeAnswer{affected: n} }

	tests := []struct {
		name    string
		answers []fakeAnswer
		want    int64
		batches int
		err     string
	}{
		{name: "nothing expired", answers: []fakeAnswer{deleted(0)}, want: 0, batches: 1},
		{name: "one short batch", answers: []fakeAnswer{deleted(42)}, want: 42, batches: 1},
		{name: "full batches until a short one", answers: []fakeAnswer{deleted(1000), deleted(1000), deleted(1)}, want: 2001, batches: 3},
		{name: "exactly a full batch: one more to be sure", answers: []fakeAnswer{deleted(1000), deleted(0)}, want: 1000, batches: 2},
		{
			name: "a failure returns the total so far", answers: []fakeAnswer{deleted(1000), {err: errBoom}},
			want: 1000, batches: 2, err: "delete expired refresh tokens: boom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL()
			for _, a := range tt.answers {
				db.on("DeleteExpiredRefreshTokens", a)
			}
			n, err := NewPostgresRepository(db.open(t)).DeleteExpiredRefreshTokens(t.Context(), now)
			if tt.err != "" {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertEqual(t, err.Error(), tt.err)
			} else {
				testx.AssertNoError(t, err)
			}
			testx.AssertEqual(t, n, tt.want)
			calls := refreshCleanupCalls(db)
			testx.AssertEqual(t, len(calls), tt.batches)
			for _, c := range calls {
				// Expired at now: a token is usable until its expiry.
				want := []driver.Value{now, int64(1000)}
				testx.AssertTrue(t, reflect.DeepEqual(c.args, want), "args %v, want %v", c.args, want)
				testx.AssertEqual(t, c.tx, 0, "each batch commits on its own")
			}
		})
	}
}
