package product

// Bab 6 artikel-05: the image rows of PostgresRepository, on the fake SQL
// driver (fakesql_test.go). The SQL itself runs against PostgreSQL in
// tests/integration.

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
	"github.com/santekno/sdk/uuidx"
)

var imgCreated = time.Date(2026, 10, 20, 8, 0, 0, 0, time.UTC)

// lockedForImages is a database where imgProductID exists and has images
// images, the last at position next-1.
func lockedForImages(images, next int64) *fakeSQL {
	return newFakeSQL().
		on("LockProductForImages", rows(imgProductID)).
		on("CountProductImages", rows(images, next))
}

func TestPostgresRepository_CreatePendingImage(t *testing.T) {
	updated := imgCreated.Add(time.Second)
	db := lockedForImages(9, 12).on("InsertProductImage", rows(imgCreated, updated))

	img, err := NewPostgresRepository(db.open(t)).CreatePendingImage(context.Background(), imgProductID, "image/webp", 4096)

	testx.AssertNoError(t, err)
	assertLockedFirst(t, db, "LockProductForImages")
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,LockProductForImages,CountProductImages,InsertProductImage,COMMIT")
	assertSQL(t, db, "LockProductForImages", "WHERE id = $1 FOR NO KEY UPDATE")
	// The cap counts every image of the product, pending uploads too: the
	// count has no status filter.
	assertSQL(t, db, "CountProductImages", "SELECT count(*) AS images", "FROM product_images WHERE product_id = $1")
	testx.AssertFalse(t, strings.Contains(db.sqlOf("CountProductImages"), "status"), db.sqlOf("CountProductImages"))
	lock, _ := db.call("LockProductForImages")
	assertArgs(t, lock.args, []driver.Value{imgProductID})
	count, _ := db.call("CountProductImages")
	assertArgs(t, count.args, []driver.Value{imgProductID})

	testx.AssertTrue(t, uuidx.IsValidUUID(img.ID), "id %q", img.ID)
	testx.AssertEqual(t, img.ProductID, imgProductID)
	testx.AssertEqual(t, img.Position, int16(12), "the next position, not the count")
	testx.AssertEqual(t, img.Status, ImagePendingUpload)
	testx.AssertEqual(t, img.ContentType, "image/webp")
	testx.AssertEqual(t, img.SizeBytes, int32(4096))
	testx.AssertEqual(t, img.OriginalKey, "uploads/"+imgProductID+"/"+img.ID+"/original")
	insert, _ := db.call("InsertProductImage")
	assertArgs(t, insert.args, []driver.Value{img.ID, imgProductID, int64(12), "image/webp", int64(4096), img.OriginalKey})
	// The database sets the timestamps; the image carries what it returned.
	assertSQL(t, db, "InsertProductImage", "RETURNING created_at, updated_at")
	testx.AssertTrue(t, img.CreatedAt.Equal(imgCreated), "created_at %v", img.CreatedAt)
	testx.AssertTrue(t, img.UpdatedAt.Equal(updated), "updated_at %v", img.UpdatedAt)
}

func TestPostgresRepository_CreatePendingImage_Limit(t *testing.T) {
	for _, n := range []int64{MaxImagesPerProduct, MaxImagesPerProduct + 1} {
		db := lockedForImages(n, n)
		_, err := NewPostgresRepository(db.open(t)).CreatePendingImage(context.Background(), imgProductID, "image/png", 1)
		testx.AssertTrue(t, errors.Is(err, ErrImageLimit), "%d images: err = %v", n, err)
		testx.AssertFalse(t, db.ran("InsertProductImage"), "%d images: inserted anyway", n)
		testx.AssertTrue(t, db.ran("ROLLBACK"))
		testx.AssertFalse(t, db.ran("COMMIT"))
	}
	testx.AssertEqual(t, MaxImagesPerProduct, 10)
}

func TestPostgresRepository_CreatePendingImage_Errors(t *testing.T) {
	tests := []struct {
		name     string
		db       *fakeSQL
		want     error
		wantText string
		ran      string // the last statement that must have run
		notRan   string
	}{
		{name: "unknown product", db: newFakeSQL(), want: ErrNotFound, wantText: ErrNotFound.Error(), ran: "LockProductForImages", notRan: "CountProductImages"},
		{name: "lock fails", db: newFakeSQL().on("LockProductForImages", failWith(errBoom)), want: errBoom, wantText: "lock product: boom", ran: "LockProductForImages", notRan: "CountProductImages"},
		{
			name: "count fails", db: newFakeSQL().on("LockProductForImages", rows(imgProductID)).on("CountProductImages", failWith(errBoom)),
			want: errBoom, wantText: "count images: boom", ran: "CountProductImages", notRan: "InsertProductImage",
		},
		{
			name: "insert fails", db: lockedForImages(0, 0).on("InsertProductImage", failWith(errBoom)),
			want: errBoom, wantText: "insert image: boom", ran: "InsertProductImage", notRan: "COMMIT",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewPostgresRepository(tt.db.open(t)).CreatePendingImage(context.Background(), imgProductID, "image/png", 1)
			testx.AssertTrue(t, errors.Is(err, tt.want), "err = %v", err)
			testx.AssertEqual(t, err.Error(), tt.wantText)
			testx.AssertTrue(t, tt.db.ran(tt.ran))
			testx.AssertFalse(t, tt.db.ran(tt.notRan))
			testx.AssertTrue(t, tt.db.ran("ROLLBACK"))
		})
	}
}

func TestPostgresRepository_GetImage(t *testing.T) {
	t.Run("found", func(t *testing.T) {
		db := newFakeSQL().on("GetProductImage", rows(imageRow(imgID, imgProductID, ImageReady, 2, twoVariants)...))
		got, err := NewPostgresRepository(db.open(t)).GetImage(context.Background(), imgProductID, imgID)
		testx.AssertNoError(t, err)
		call, _ := db.call("GetProductImage")
		assertArgs(t, call.args, []driver.Value{imgID, imgProductID})
		assertSQL(t, db, "GetProductImage", "WHERE id = $1 AND product_id = $2")
		testx.AssertEqual(t, got.ID, imgID)
		testx.AssertEqual(t, got.ProductID, imgProductID)
		testx.AssertEqual(t, got.Position, int16(2))
		testx.AssertEqual(t, got.Alt, "alt "+imgID)
		testx.AssertEqual(t, got.Status, ImageReady)
		testx.AssertEqual(t, got.ContentType, "image/jpeg")
		testx.AssertEqual(t, got.SizeBytes, int32(2048))
		testx.AssertEqual(t, got.OriginalKey, ImageKey(imgProductID, imgID))
		testx.AssertEqual(t, got.Width, int32(1000))
		testx.AssertEqual(t, got.Height, int32(750))
		testx.AssertTrue(t, got.CreatedAt.Equal(imgCreated))
		testx.AssertTrue(t, got.UpdatedAt.Equal(imgCreated))
		testx.AssertEqual(t, len(got.Variants), 2)
		testx.AssertEqual(t, got.Variants[1], ImageVariant{Width: 800, Height: 600, Key: "k800"})
	})
	t.Run("pending: no dimensions yet", func(t *testing.T) {
		db := newFakeSQL().on("GetProductImage", rows(imageRow(imgID, imgProductID, ImagePendingUpload, 0, "[]")...))
		got, err := NewPostgresRepository(db.open(t)).GetImage(context.Background(), imgProductID, imgID)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, got.Width, int32(0))
		testx.AssertEqual(t, got.Height, int32(0))
		testx.AssertEqual(t, len(got.Variants), 0)
	})
	t.Run("variants that do not decode are none", func(t *testing.T) {
		db := newFakeSQL().on("GetProductImage", rows(imageRow(imgID, imgProductID, ImageReady, 0, "{not json")...))
		got, err := NewPostgresRepository(db.open(t)).GetImage(context.Background(), imgProductID, imgID)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got.Variants), 0)
		_, ok := got.Largest()
		testx.AssertFalse(t, ok)
	})
	t.Run("not found", func(t *testing.T) {
		_, err := NewPostgresRepository(newFakeSQL().open(t)).GetImage(context.Background(), imgProductID, imgID)
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
	})
	t.Run("query fails", func(t *testing.T) {
		db := newFakeSQL().on("GetProductImage", failWith(errBoom))
		_, err := NewPostgresRepository(db.open(t)).GetImage(context.Background(), imgProductID, imgID)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "query image: boom")
	})
}

func TestPostgresRepository_ConfirmImage(t *testing.T) {
	img := Image{ID: imgID, ProductID: imgProductID, Alt: "Kaos", Width: 1200, Height: 900}
	t.Run("confirmed", func(t *testing.T) {
		db := newFakeSQL()
		err := NewPostgresRepository(db.open(t)).ConfirmImage(context.Background(), img, ImageProcessing)
		testx.AssertNoError(t, err)
		call, _ := db.call("ConfirmProductImage")
		// Width and height are stored (NOT NULL from now on).
		assertArgs(t, call.args, []driver.Value{ImageProcessing, "Kaos", int64(1200), int64(900), imgID, imgProductID})
		assertSQL(t, db, "ConfirmProductImage", "WHERE id = $5 AND product_id = $6 AND status = 'pending_upload'")
	})
	t.Run("no longer pending", func(t *testing.T) {
		db := newFakeSQL().on("ConfirmProductImage", fakeAnswer{affected: 0})
		err := NewPostgresRepository(db.open(t)).ConfirmImage(context.Background(), img, ImageProcessing)
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
	})
	t.Run("update fails", func(t *testing.T) {
		db := newFakeSQL().on("ConfirmProductImage", failWith(errBoom))
		err := NewPostgresRepository(db.open(t)).ConfirmImage(context.Background(), img, ImageProcessing)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "confirm image: boom")
	})
}

func TestPostgresRepository_DeleteImage(t *testing.T) {
	db := newFakeSQL()
	testx.AssertNoError(t, NewPostgresRepository(db.open(t)).DeleteImage(context.Background(), imgProductID, imgID))
	call, _ := db.call("DeleteProductImage")
	assertArgs(t, call.args, []driver.Value{imgID, imgProductID})
	assertSQL(t, db, "DeleteProductImage", "WHERE id = $1 AND product_id = $2")

	db = newFakeSQL().on("DeleteProductImage", fakeAnswer{affected: 0})
	err := NewPostgresRepository(db.open(t)).DeleteImage(context.Background(), imgProductID, imgID)
	testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)

	db = newFakeSQL().on("DeleteProductImage", failWith(errBoom))
	err = NewPostgresRepository(db.open(t)).DeleteImage(context.Background(), imgProductID, imgID)
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertEqual(t, err.Error(), "delete image: boom")
}
