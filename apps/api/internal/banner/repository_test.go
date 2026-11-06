package banner

import (
	"context"
	"database/sql/driver"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestPostgresRepository_ListActive(t *testing.T) {
	t.Run("maps every column and keeps the row order", func(t *testing.T) {
		db := newFakeSQL().on("ListActiveBanners", fakeAnswer{rows: [][]driver.Value{
			{"b1", "Diskon", "Sampai Minggu", "Belanja", "kaos", "#112233"},
			{"b2", "Baru", "Koleksi baru", "Lihat", "kemeja", "#445566"},
		}})

		got, err := NewPostgresRepository(db.open(t)).ListActive(context.Background())

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 2)
		testx.AssertEqual(t, got[0], Banner{
			ID: "b1", Title: "Diskon", Subtitle: "Sampai Minggu", CTALabel: "Belanja",
			LinkCategorySlug: "kaos", BackgroundColor: "#112233",
		})
		testx.AssertEqual(t, got[1].ID, "b2")
		testx.AssertEqual(t, len(db.names()), 1, "one query")
	})
	t.Run("NULL columns become empty strings", func(t *testing.T) {
		db := newFakeSQL().on("ListActiveBanners", fakeAnswer{rows: [][]driver.Value{
			{"b1", "Polos", nil, nil, nil, "#112233"},
		}})

		got, err := NewPostgresRepository(db.open(t)).ListActive(context.Background())

		testx.AssertNoError(t, err)
		testx.AssertEqual(t, got[0], Banner{ID: "b1", Title: "Polos", BackgroundColor: "#112233"})
	})
	t.Run("no rows is an empty, non-nil slice", func(t *testing.T) {
		got, err := NewPostgresRepository(newFakeSQL().open(t)).ListActive(context.Background())

		testx.AssertNoError(t, err)
		testx.AssertTrue(t, got != nil, "want an empty slice, not nil")
		testx.AssertEqual(t, len(got), 0)
	})
	t.Run("a query error is wrapped", func(t *testing.T) {
		boom := errors.New("boom")
		db := newFakeSQL().on("ListActiveBanners", fakeAnswer{err: boom})

		got, err := NewPostgresRepository(db.open(t)).ListActive(context.Background())

		testx.AssertTrue(t, errors.Is(err, boom), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "query banners: boom")
		testx.AssertTrue(t, got == nil)
	})
}
