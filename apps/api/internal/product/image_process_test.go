package product

// Bab 6 artikel-06: the worker's resize of confirmed images.

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"image/jpeg"
	"testing"

	"github.com/santekno/sdk/testx"
)

func processingImage(id string) Image {
	return Image{ID: id, ProductID: imgProductID, Status: ImageProcessing, ContentType: "image/jpeg", OriginalKey: ImageKey(imgProductID, id)}
}

func TestImageService_ProcessPending(t *testing.T) {
	img := processingImage(imgID)
	repo := newFakeImageRepo()
	repo.processing = []Image{img}
	store := newFakeStore().with(img.OriginalKey, "image/jpeg", jpegOf(t, 1000, 750))

	done, err := NewImageService(repo, store).ProcessPending(context.Background())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, done, 1)
	testx.AssertEqual(t, repo.processingLimit, int32(ProcessBatchSize))
	testx.AssertEqual(t, len(store.puts), 2)
	wantKeys := []string{"products/" + imgProductID + "/" + imgID + "/400.jpg", "products/" + imgProductID + "/" + imgID + "/800.jpg"}
	wantSizes := [][2]int{{400, 300}, {800, 600}}
	for i, put := range store.puts {
		testx.AssertEqual(t, put.key, wantKeys[i])
		testx.AssertEqual(t, put.contentType, "image/jpeg")
		cfg, err := jpeg.DecodeConfig(bytes.NewReader(put.data))
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, [2]int{cfg.Width, cfg.Height}, wantSizes[i])
	}
	testx.AssertEqual(t, len(repo.finished), 1)
	f := repo.finished[0]
	testx.AssertEqual(t, f.id, imgID)
	testx.AssertEqual(t, f.status, ImageReady)
	testx.AssertEqual(t, len(f.variants), 2)
	testx.AssertEqual(t, f.variants[0], ImageVariant{Width: 400, Height: 300, Key: wantKeys[0]})
	testx.AssertEqual(t, f.variants[1], ImageVariant{Width: 800, Height: 600, Key: wantKeys[1]})
	testx.AssertEqual(t, store.closed, 1, "the original is closed")
	_, kept := store.objects[img.OriginalKey]
	testx.AssertTrue(t, kept, "the original is kept")
}

func TestImageService_ProcessPending_SmallImageIsNotUpscaled(t *testing.T) {
	img := processingImage(imgID)
	repo := newFakeImageRepo()
	repo.processing = []Image{img}
	store := newFakeStore().with(img.OriginalKey, "image/jpeg", jpegOf(t, 300, 200))

	done, err := NewImageService(repo, store).ProcessPending(context.Background())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, done, 1)
	testx.AssertEqual(t, len(repo.finished), 1)
	testx.AssertEqual(t, len(repo.finished[0].variants), 1)
	testx.AssertEqual(t, repo.finished[0].variants[0], ImageVariant{Width: 300, Height: 200, Key: VariantKey(imgProductID, imgID, 300)})
}

func TestImageService_ProcessPending_EachOutcome(t *testing.T) {
	good, bad, flaky, gone := processingImage(imgID), processingImage(imgID2), processingImage(imgID3), processingImage("0190c8a0-0000-7000-8000-0000000000b4")
	repo := newFakeImageRepo()
	repo.processing = []Image{flaky, bad, gone, good}
	repo.finishErrs[gone.ID] = ErrImageNotFound // deleted while it was resized
	store := newFakeStore().
		with(good.OriginalKey, "image/jpeg", jpegOf(t, 500, 500)).
		with(bad.OriginalKey, "image/jpeg", []byte("this was never an image")).
		with(gone.OriginalKey, "image/jpeg", jpegOf(t, 100, 100))
	store.getErrs[flaky.OriginalKey] = errStore
	ctx, logs := logged()

	done, err := NewImageService(repo, store).ProcessPending(ctx)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, done, 2, "the failed and the good image; not the storage error, not the deleted one")
	testx.AssertEqual(t, len(repo.finished), 3)
	byID := map[string]finishCall{}
	for _, f := range repo.finished {
		byID[f.id] = f
	}
	_, retried := byID[flaky.ID]
	testx.AssertFalse(t, retried, "a storage error leaves the image for the next run")
	testx.AssertEqual(t, byID[bad.ID].status, ImageFailed)
	testx.AssertTrue(t, byID[bad.ID].variants == nil, "a failed image has no variants")
	testx.AssertEqual(t, byID[good.ID].status, ImageReady)
	testx.AssertEqual(t, len(byID[good.ID].variants), 2)
	testx.AssertContains(t, logs.String(), `"msg":"image cannot be processed"`)
	testx.AssertContains(t, logs.String(), `"msg":"process image"`)
}

func TestImageService_ProcessPending_PutFailsLeavesTheImage(t *testing.T) {
	img := processingImage(imgID)
	repo := newFakeImageRepo()
	repo.processing = []Image{img}
	store := newFakeStore().with(img.OriginalKey, "image/jpeg", jpegOf(t, 1000, 500))
	store.putErrs[VariantKey(imgProductID, imgID, 800)] = errStore

	done, err := NewImageService(repo, store).ProcessPending(context.Background())

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, done, 0)
	testx.AssertEqual(t, len(repo.finished), 0, "neither ready nor failed: the next run tries again")
}

func TestImageService_ProcessPending_Errors(t *testing.T) {
	t.Run("storage disabled", func(t *testing.T) {
		repo := newFakeImageRepo()
		done, err := NewImageService(repo, nil).ProcessPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, ErrStorageDisabled))
		testx.AssertEqual(t, done, 0)
		testx.AssertEqual(t, repo.processingLimit, int32(0), "nothing was listed")
	})
	t.Run("the list fails", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.processingErr = errBoom
		done, err := NewImageService(repo, newFakeStore()).ProcessPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, done, 0)
	})
	t.Run("finishing fails: the run stops", func(t *testing.T) {
		first, second, third := processingImage(imgID), processingImage(imgID2), processingImage(imgID3)
		repo := newFakeImageRepo()
		repo.processing = []Image{first, second, third}
		repo.finishErrs[second.ID] = errBoom
		store := newFakeStore().
			with(first.OriginalKey, "image/jpeg", jpegOf(t, 100, 100)).
			with(second.OriginalKey, "image/jpeg", jpegOf(t, 100, 100)).
			with(third.OriginalKey, "image/jpeg", jpegOf(t, 100, 100))
		done, err := NewImageService(repo, store).ProcessPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, done, 1, "what was finished before the failure")
		testx.AssertEqual(t, len(repo.finished), 2)
	})
	t.Run("failing an undecodable image fails", func(t *testing.T) {
		img := processingImage(imgID)
		repo := newFakeImageRepo()
		repo.processing = []Image{img}
		repo.finishErrs[img.ID] = errBoom
		store := newFakeStore().with(img.OriginalKey, "image/jpeg", []byte("nope"))
		done, err := NewImageService(repo, store).ProcessPending(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, done, 0)
		testx.AssertEqual(t, repo.finished[0].status, ImageFailed)
	})
}

func TestPostgresRepository_ProcessingImages(t *testing.T) {
	db := newFakeSQL().on("ListProcessingImages", fakeAnswer{rows: [][]driver.Value{
		imageRow(imgID, imgProductID, ImageProcessing, 0, "[]"),
		imageRow(imgID2, imgProductID, ImageProcessing, 1, "[]"),
	}})

	got, err := NewPostgresRepository(db.open(t)).ProcessingImages(context.Background(), 10)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 2)
	testx.AssertEqual(t, got[0].ID, imgID)
	testx.AssertEqual(t, got[1].Position, int16(1))
	testx.AssertEqual(t, got[1].OriginalKey, ImageKey(imgProductID, imgID2))
	call, _ := db.call("ListProcessingImages")
	assertArgs(t, call.args, []driver.Value{int64(10)})
	assertSQL(t, db, "ListProcessingImages", "WHERE status = 'processing'", "ORDER BY updated_at", "LIMIT $1")

	db = newFakeSQL().on("ListProcessingImages", failWith(errBoom))
	_, err = NewPostgresRepository(db.open(t)).ProcessingImages(context.Background(), 10)
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertEqual(t, err.Error(), "query processing images: boom")
}

func TestPostgresRepository_FinishImage(t *testing.T) {
	t.Run("ready with its variants", func(t *testing.T) {
		db := newFakeSQL()
		variants := []ImageVariant{{Width: 400, Height: 300, Key: "k400"}, {Width: 800, Height: 600, Key: "k800"}}
		err := NewPostgresRepository(db.open(t)).FinishImage(context.Background(), imgID, ImageReady, variants)
		testx.AssertNoError(t, err)
		call, _ := db.call("FinishProductImage")
		testx.AssertEqual(t, call.args[0], driver.Value(ImageReady))
		testx.AssertEqual(t, string(call.args[1].([]byte)), twoVariants)
		testx.AssertEqual(t, call.args[2], driver.Value(imgID))
		assertSQL(t, db, "FinishProductImage", "WHERE id = $3 AND status = 'processing'")
	})
	t.Run("failed: an empty list, not null", func(t *testing.T) {
		db := newFakeSQL()
		err := NewPostgresRepository(db.open(t)).FinishImage(context.Background(), imgID, ImageFailed, nil)
		testx.AssertNoError(t, err)
		call, _ := db.call("FinishProductImage")
		testx.AssertEqual(t, string(call.args[1].([]byte)), "[]")
		var decoded []ImageVariant
		testx.AssertNoError(t, json.Unmarshal(call.args[1].([]byte), &decoded))
	})
	t.Run("no longer processing", func(t *testing.T) {
		db := newFakeSQL().on("FinishProductImage", fakeAnswer{affected: 0})
		err := NewPostgresRepository(db.open(t)).FinishImage(context.Background(), imgID, ImageReady, nil)
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
	})
	t.Run("the update fails", func(t *testing.T) {
		db := newFakeSQL().on("FinishProductImage", failWith(errBoom))
		err := NewPostgresRepository(db.open(t)).FinishImage(context.Background(), imgID, ImageReady, nil)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "finish image: boom")
	})
}
