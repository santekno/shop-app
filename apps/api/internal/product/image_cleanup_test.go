package product

// Bab 6 artikel-07: the hourly cleanup of uploads signed but never
// confirmed.

import (
	"context"
	"database/sql/driver"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func staleKeys(n int, prefix string) []string {
	keys := make([]string, n)
	for i := range keys {
		keys[i] = fmt.Sprintf("uploads/p/%s-%03d/original", prefix, i)
	}
	return keys
}

func TestImageService_CleanupPending(t *testing.T) {
	now := time.Date(2026, 10, 24, 10, 0, 0, 0, time.UTC)

	t.Run("batches of 100 until a short one", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.staleBatches = [][]string{staleKeys(100, "a"), staleKeys(2, "b")}
		store := newFakeStore()

		n, err := NewImageService(repo, store).CleanupPending(context.Background(), now)

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 102)
		testx.AssertEqual(t, len(repo.staleCalls), 2)
		for _, c := range repo.staleCalls {
			testx.AssertTrue(t, c.before.Equal(now.Add(-24*time.Hour)), "cutoff %v", c.before)
			testx.AssertEqual(t, c.limit, int32(100))
		}
		testx.AssertEqual(t, len(store.deleted), 102, "every row's file is deleted")
		testx.AssertEqual(t, store.deleted[0], "uploads/p/a-000/original")
		testx.AssertEqual(t, store.deleted[101], "uploads/p/b-001/original")
	})
	t.Run("nothing stale: one query", func(t *testing.T) {
		repo := newFakeImageRepo()
		store := newFakeStore()
		n, err := NewImageService(repo, store).CleanupPending(context.Background(), now)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 0)
		testx.AssertEqual(t, len(repo.staleCalls), 1)
		testx.AssertEqual(t, len(store.deleted), 0)
	})
	t.Run("exactly 100: one more query finds none", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.staleBatches = [][]string{staleKeys(100, "a")}
		n, err := NewImageService(repo, newFakeStore()).CleanupPending(context.Background(), now)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 100)
		testx.AssertEqual(t, len(repo.staleCalls), 2)
	})
	t.Run("a file that cannot be deleted is only logged", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.staleBatches = [][]string{staleKeys(3, "a")}
		store := newFakeStore()
		store.deleteErr = errStore
		ctx, logs := logged()
		n, err := NewImageService(repo, store).CleanupPending(ctx, now)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 3)
		testx.AssertEqual(t, len(store.deleted), 3)
		testx.AssertEqual(t, strings.Count(logs.String(), `"msg":"delete abandoned upload"`), 3)
	})
	t.Run("the query fails: the count so far", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.staleBatches = [][]string{staleKeys(100, "a")}
		repo.staleErrAt, repo.staleErr = 2, errBoom
		n, err := NewImageService(repo, newFakeStore()).CleanupPending(context.Background(), now)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, n, 100)
	})
	t.Run("storage disabled: nothing to clean", func(t *testing.T) {
		repo := newFakeImageRepo()
		n, err := NewImageService(repo, nil).CleanupPending(context.Background(), now)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 0)
		testx.AssertEqual(t, len(repo.staleCalls), 0)
	})
}

func TestPostgresRepository_DeleteStalePendingImages(t *testing.T) {
	before := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	db := newFakeSQL().on("DeleteStalePendingImages", fakeAnswer{rows: [][]driver.Value{{"k1"}, {"k2"}}})

	keys, err := NewPostgresRepository(db.open(t)).DeleteStalePendingImages(context.Background(), before, 100)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, joinKeys(keys), "k1,k2")
	call, _ := db.call("DeleteStalePendingImages")
	assertArgs(t, call.args, []driver.Value{before, int64(100)})
	assertSQL(t, db, "DeleteStalePendingImages", "pi.status = 'pending_upload' AND pi.created_at < $1", "LIMIT $2", "FOR UPDATE SKIP LOCKED", "RETURNING original_key")

	db = newFakeSQL().on("DeleteStalePendingImages", failWith(errBoom))
	keys, err = NewPostgresRepository(db.open(t)).DeleteStalePendingImages(context.Background(), before, 100)
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertEqual(t, err.Error(), "delete stale pending images: boom")
	testx.AssertEqual(t, len(keys), 0)
}
