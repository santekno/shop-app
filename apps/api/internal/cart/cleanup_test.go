package cart

// Bab 6 artikel 07: the worker's hourly cleanup of abandoned guest carts.

import (
	"database/sql/driver"
	"errors"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestDeleteAbandonedGuestCarts(t *testing.T) {
	testx.AssertEqual(t, GuestCartTTL, 30*24*time.Hour)
	now := time.Date(2026, 10, 24, 8, 0, 0, 0, time.UTC)
	before := time.Date(2026, 9, 24, 8, 0, 0, 0, time.UTC) // 30 days earlier
	deleted := func(n int64) fakeAnswer { return fakeAnswer{affected: n} }

	tests := []struct {
		name    string
		answers []fakeAnswer
		want    int64
		batches int
		err     string
	}{
		{name: "nothing abandoned", answers: []fakeAnswer{deleted(0)}, want: 0, batches: 1},
		{name: "one short batch", answers: []fakeAnswer{deleted(12)}, want: 12, batches: 1},
		{name: "full batches until a short one", answers: []fakeAnswer{deleted(500), deleted(500), deleted(499)}, want: 1499, batches: 3},
		{name: "exactly a full batch: one more to be sure", answers: []fakeAnswer{deleted(500), deleted(0)}, want: 500, batches: 2},
		{
			name: "a failure returns the total so far", answers: []fakeAnswer{deleted(500), deleted(500), failWith(errBoom)},
			want: 1000, batches: 3, err: "delete abandoned guest carts: boom",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL()
			for _, a := range tt.answers {
				db.on("DeleteAbandonedGuestCarts", a)
			}
			n, err := NewPostgresRepository(db.open(t)).DeleteAbandonedGuestCarts(t.Context(), now)
			if tt.err != "" {
				testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
				testx.AssertEqual(t, err.Error(), tt.err)
			} else {
				testx.AssertNoError(t, err)
			}
			testx.AssertEqual(t, n, tt.want)
			calls := db.calledAll("DeleteAbandonedGuestCarts")
			testx.AssertEqual(t, len(calls), tt.batches)
			for _, c := range calls {
				assertArgs(t, c.args, []driver.Value{before, int64(500)})
				testx.AssertEqual(t, c.tx, 0, "each batch commits on its own")
			}
		})
	}
}
