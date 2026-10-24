package product

import (
	"context"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestImageKeys(t *testing.T) {
	// The uploaded original lives under uploads/, which is never public (it
	// keeps the seller's metadata and is not checked yet); only the
	// worker's variants live under products/ (ADR 0007).
	testx.AssertEqual(t, ImageKey("p1", "i1"), "uploads/p1/i1/original")
	testx.AssertEqual(t, VariantKey("p1", "i1", 400), "products/p1/i1/400.jpg")
	img := Image{OriginalKey: "o", Variants: []ImageVariant{{Width: 400, Key: "a"}, {Width: 800, Key: "b"}}}
	testx.AssertEqual(t, joinKeys(img.Keys()), "o,a,b")
	testx.AssertEqual(t, joinKeys(Image{OriginalKey: "o"}.Keys()), "o")
	largest, ok := img.Largest()
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, largest.Key, "b")
	_, ok = Image{}.Largest()
	testx.AssertFalse(t, ok)
	for _, ct := range []string{"image/jpeg", "image/png", "image/webp"} {
		testx.AssertTrue(t, AllowedImageType(ct), ct)
	}
	for _, ct := range []string{"image/gif", "image/svg+xml", "IMAGE/PNG", "", "text/html"} {
		testx.AssertFalse(t, AllowedImageType(ct), ct)
	}
	testx.AssertEqual(t, (&UploadInvalidError{Reason: "size_mismatch"}).Error(), "upload invalid: size_mismatch")
}

func TestImageService_StartUpload(t *testing.T) {
	created := Image{ID: imgID, ProductID: imgProductID, Position: 3, Status: ImagePendingUpload,
		ContentType: "image/png", SizeBytes: 2048, OriginalKey: ImageKey(imgProductID, imgID)}
	repo := newFakeImageRepo()
	repo.createImg = created
	store := newFakeStore()

	got, err := NewImageService(repo, store).StartUpload(context.Background(), imgProductID, "image/png", 2048)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(repo.created), 1)
	testx.AssertEqual(t, repo.created[0], createCall{productID: imgProductID, contentType: "image/png", size: 2048})
	testx.AssertEqual(t, len(store.presigns), 1)
	testx.AssertEqual(t, store.presigns[0], presignCall{
		key: "uploads/" + imgProductID + "/" + imgID + "/original", contentType: "image/png", size: 2048, ttl: 15 * time.Minute,
	})
	testx.AssertEqual(t, got.Image.ID, imgID)
	testx.AssertEqual(t, got.Image.Position, int16(3))
	testx.AssertEqual(t, got.Upload.URL, "https://uploads.test/goshop/"+created.OriginalKey+"?X-Amz-Signature=sig")
	testx.AssertEqual(t, got.Upload.Headers["Content-Length"], "2048")
}

func TestImageService_StartUpload_Errors(t *testing.T) {
	t.Run("storage disabled", func(t *testing.T) {
		repo := newFakeImageRepo()
		_, err := NewImageService(repo, nil).StartUpload(context.Background(), imgProductID, "image/png", 1)
		testx.AssertTrue(t, errors.Is(err, ErrStorageDisabled), "err = %v", err)
		testx.AssertEqual(t, len(repo.created), 0, "no row without storage")
	})
	for _, repoErr := range []error{ErrImageLimit, ErrNotFound, errBoom} {
		t.Run("repository: "+repoErr.Error(), func(t *testing.T) {
			repo := newFakeImageRepo()
			repo.createErr = repoErr
			store := newFakeStore()
			_, err := NewImageService(repo, store).StartUpload(context.Background(), imgProductID, "image/png", 1)
			testx.AssertTrue(t, errors.Is(err, repoErr), "err = %v", err)
			testx.AssertEqual(t, err.Error(), "start upload: "+repoErr.Error())
			testx.AssertEqual(t, len(store.presigns), 0, "nothing is signed for a refused upload")
		})
	}
	t.Run("presign fails", func(t *testing.T) {
		repo := newFakeImageRepo()
		repo.createImg = pendingImage(imgID, "image/png", []byte("x"))
		store := newFakeStore()
		store.presignErr = errStore
		got, err := NewImageService(repo, store).StartUpload(context.Background(), imgProductID, "image/png", 1)
		testx.AssertTrue(t, errors.Is(err, errStore), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "start upload: s3 unavailable")
		testx.AssertEqual(t, got.Image.ID, "")
	})
}

func TestImageService_Confirm(t *testing.T) {
	tests := []struct {
		name        string
		contentType string
		data        []byte
		wantW       int32
		wantH       int32
	}{
		{name: "jpeg", contentType: "image/jpeg", data: jpegOf(t, 64, 48), wantW: 64, wantH: 48},
		{name: "png", contentType: "image/png", data: pngHeader(1200, 900), wantW: 1200, wantH: 900},
		{name: "webp", contentType: "image/webp", data: mustBase64(t, "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), wantW: 1, wantH: 1},
		{name: "6000 px wide", contentType: "image/png", data: pngHeader(6000, 10), wantW: 6000, wantH: 10},
		{name: "exactly 24 megapixels", contentType: "image/png", data: pngHeader(6000, 4000), wantW: 6000, wantH: 4000},
		{name: "exactly 24 megapixels, portrait", contentType: "image/png", data: pngHeader(4000, 6000), wantW: 4000, wantH: 6000},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			img := pendingImage(imgID, tt.contentType, tt.data)
			repo := newFakeImageRepo(img)
			store := newFakeStore().with(img.OriginalKey, tt.contentType, tt.data)

			got, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "Kaos hitam, tampak depan")

			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(repo.confirmed), 1)
			c := repo.confirmed[0]
			testx.AssertEqual(t, c.status, ImageProcessing)
			testx.AssertEqual(t, c.img.ID, imgID)
			testx.AssertEqual(t, c.img.ProductID, imgProductID)
			testx.AssertEqual(t, c.img.Alt, "Kaos hitam, tampak depan")
			testx.AssertEqual(t, c.img.Width, tt.wantW)
			testx.AssertEqual(t, c.img.Height, tt.wantH)
			testx.AssertEqual(t, got.Status, ImageProcessing, "the image as stored after the confirm")
			testx.AssertEqual(t, got.Width, tt.wantW)
			testx.AssertEqual(t, repo.getCalls, 2)
			testx.AssertEqual(t, len(repo.deleted)+len(store.deleted), 0)
			testx.AssertEqual(t, store.closed, 1, "the object is closed")
		})
	}
}

func TestImageService_Confirm_Refused(t *testing.T) {
	jpg := jpegOf(t, 32, 32)
	tests := []struct {
		name         string
		declaredType string
		sizeDelta    int32 // declared size minus the stored data's length
		storedType   string
		data         []byte
		reason       string
	}{
		{name: "fewer bytes than declared", declaredType: "image/jpeg", sizeDelta: 1, storedType: "image/jpeg", data: jpg, reason: "size_mismatch"},
		{name: "more bytes than declared", declaredType: "image/jpeg", sizeDelta: -1, storedType: "image/jpeg", data: jpg, reason: "size_mismatch"},
		{name: "another content type", declaredType: "image/png", storedType: "image/jpeg", data: jpg, reason: "content_type_mismatch"},
		{name: "declared png, bytes are jpeg", declaredType: "image/png", storedType: "image/png", data: jpg, reason: "not_an_image_of_the_declared_type"},
		{name: "declared jpeg, bytes are text", declaredType: "image/jpeg", storedType: "image/jpeg", data: []byte("hello, I am a text file\n"), reason: "not_an_image_of_the_declared_type"},
		{name: "declared webp, bytes are png", declaredType: "image/webp", storedType: "image/webp", data: pngHeader(10, 10), reason: "not_an_image_of_the_declared_type"},
		{name: "declared jpeg, bytes are html", declaredType: "image/jpeg", storedType: "image/jpeg", data: []byte("<html><script>alert(1)</script></html>"), reason: "not_an_image_of_the_declared_type"},
		{name: "png magic then garbage", declaredType: "image/png", storedType: "image/png", data: append([]byte("\x89PNG\r\n\x1a\n"), strings.Repeat("garbage!", 8)...), reason: "unreadable_image"},
		{name: "jpeg magic then garbage", declaredType: "image/jpeg", storedType: "image/jpeg", data: append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, strings.Repeat("\x01", 40)...), reason: "unreadable_image"},
		{name: "6001 px wide", declaredType: "image/png", storedType: "image/png", data: pngHeader(6001, 10), reason: "too_many_pixels"},
		{name: "6001 px high", declaredType: "image/png", storedType: "image/png", data: pngHeader(10, 6001), reason: "too_many_pixels"},
		{name: "25 megapixels within the side limit", declaredType: "image/png", storedType: "image/png", data: pngHeader(5000, 5000), reason: "too_many_pixels"},
		{name: "one pixel over 24 megapixels", declaredType: "image/png", storedType: "image/png", data: pngHeader(6000, 4001), reason: "too_many_pixels"},
		{name: "a decompression bomb", declaredType: "image/png", storedType: "image/png", data: pngHeader(50000, 50000), reason: "too_many_pixels"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			img := pendingImage(imgID, tt.declaredType, tt.data)
			img.SizeBytes += tt.sizeDelta
			repo := newFakeImageRepo(img)
			store := newFakeStore().with(img.OriginalKey, tt.storedType, tt.data)

			got, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "alt")

			var invalid *UploadInvalidError
			if !errors.As(err, &invalid) {
				t.Fatalf("want *UploadInvalidError, got %v", err)
			}
			testx.AssertEqual(t, invalid.Reason, tt.reason)
			testx.AssertEqual(t, got.ID, "")
			testx.AssertEqual(t, len(repo.confirmed), 0, "a refused upload is never confirmed")
			testx.AssertEqual(t, joinKeys(repo.deleted), imgProductID+"/"+imgID, "the row is deleted")
			testx.AssertEqual(t, joinKeys(store.deleted), img.OriginalKey, "the file is deleted")
		})
	}
}

func TestImageService_Confirm_Errors(t *testing.T) {
	jpg := jpegOf(t, 16, 16)
	pending := pendingImage(imgID, "image/jpeg", jpg)

	t.Run("storage disabled", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		_, err := NewImageService(repo, nil).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, ErrStorageDisabled))
		testx.AssertEqual(t, repo.getCalls, 0)
	})
	t.Run("unknown image", func(t *testing.T) {
		store := newFakeStore()
		_, err := NewImageService(newFakeImageRepo(), store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
		testx.AssertEqual(t, len(store.statKeys), 0)
	})
	t.Run("image of another product", func(t *testing.T) {
		other := pending
		other.ProductID = "0190c8a0-0000-7000-8000-0000000000ff"
		_, err := NewImageService(newFakeImageRepo(other), newFakeStore()).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
	})
	t.Run("confirmed twice: returned as it is", func(t *testing.T) {
		for _, status := range []string{ImageProcessing, ImageReady, ImageFailed} {
			img := pending
			img.Status, img.Alt, img.Width = status, "first alt", 16
			repo := newFakeImageRepo(img)
			store := newFakeStore()
			got, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "second alt")
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got.Status, status)
			testx.AssertEqual(t, got.Alt, "first alt", "a second confirm changes nothing")
			testx.AssertEqual(t, len(store.statKeys), 0, "the file is not checked again")
			testx.AssertEqual(t, len(repo.confirmed), 0)
		}
	})
	t.Run("not uploaded yet: the image is kept", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		store := newFakeStore()
		_, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, ErrUploadMissing), "err = %v", err)
		testx.AssertEqual(t, len(repo.deleted), 0, "the seller may still upload")
		testx.AssertEqual(t, len(store.deleted), 0)
		testx.AssertEqual(t, len(repo.confirmed), 0)
	})
	t.Run("stat fails", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		store := newFakeStore().with(pending.OriginalKey, "image/jpeg", jpg)
		store.statErr = errStore
		_, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, errStore), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "confirm image: s3 unavailable")
		testx.AssertFalse(t, errors.Is(err, ErrUploadMissing))
		testx.AssertEqual(t, len(repo.deleted)+len(store.deleted), 0, "a storage failure deletes nothing")
	})
	t.Run("get fails", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		store := newFakeStore().with(pending.OriginalKey, "image/jpeg", jpg)
		store.getErrs[pending.OriginalKey] = errStore
		_, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, errStore), "err = %v", err)
		testx.AssertEqual(t, err.Error(), "confirm image: s3 unavailable")
		testx.AssertEqual(t, len(repo.deleted)+len(store.deleted), 0)
	})
	t.Run("the confirm update fails", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		repo.confirmErr = ErrImageNotFound
		store := newFakeStore().with(pending.OriginalKey, "image/jpeg", jpg)
		got, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
		testx.AssertEqual(t, got.ID, "")
		testx.AssertEqual(t, repo.getCalls, 1, "no read after a failed confirm")
	})
	t.Run("the read after the confirm fails", func(t *testing.T) {
		repo := newFakeImageRepo(pending)
		repo.getErrs = []error{nil, errBoom}
		store := newFakeStore().with(pending.OriginalKey, "image/jpeg", jpg)
		_, err := NewImageService(repo, store).Confirm(context.Background(), imgProductID, imgID, "")
		testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
		testx.AssertEqual(t, len(repo.confirmed), 1)
	})
}

// A refused upload whose row or file cannot be deleted is still refused;
// the failures are logged.
func TestImageService_Confirm_DiscardFailuresAreLogged(t *testing.T) {
	img := pendingImage(imgID, "image/png", pngHeader(7000, 10))
	repo := newFakeImageRepo(img)
	repo.deleteErr = errBoom
	store := newFakeStore().with(img.OriginalKey, "image/png", pngHeader(7000, 10))
	store.deleteErr = errStore
	ctx, logs := logged()

	_, err := NewImageService(repo, store).Confirm(ctx, imgProductID, imgID, "")

	var invalid *UploadInvalidError
	testx.AssertTrue(t, errors.As(err, &invalid), "err = %v", err)
	testx.AssertEqual(t, invalid.Reason, "too_many_pixels")
	testx.AssertEqual(t, len(repo.deleted), 1)
	testx.AssertEqual(t, len(store.deleted), 1, "the file is deleted even when the row is not")
	testx.AssertContains(t, logs.String(), `"msg":"delete refused image"`)
	testx.AssertContains(t, logs.String(), `"msg":"delete refused upload"`)
	testx.AssertContains(t, logs.String(), imgID)

	// A row already gone (a concurrent delete) is not worth an error log.
	repo = newFakeImageRepo(img)
	repo.deleteErr = ErrImageNotFound
	store = newFakeStore().with(img.OriginalKey, "image/png", pngHeader(7000, 10))
	ctx, logs = logged()
	_, err = NewImageService(repo, store).Confirm(ctx, imgProductID, imgID, "")
	testx.AssertTrue(t, errors.As(err, &invalid))
	testx.AssertFalse(t, strings.Contains(logs.String(), "delete refused image"), logs.String())
}

func TestImageService_Delete(t *testing.T) {
	ready := Image{
		ID: imgID, ProductID: imgProductID, Status: ImageReady, OriginalKey: ImageKey(imgProductID, imgID),
		Variants: []ImageVariant{
			{Width: 400, Height: 300, Key: VariantKey(imgProductID, imgID, 400)},
			{Width: 800, Height: 600, Key: VariantKey(imgProductID, imgID, 800)},
		},
	}
	t.Run("the row, then every file", func(t *testing.T) {
		repo := newFakeImageRepo(ready)
		store := newFakeStore()
		err := NewImageService(repo, store).Delete(context.Background(), imgProductID, imgID)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, joinKeys(repo.deleted), imgProductID+"/"+imgID)
		testx.AssertEqual(t, joinKeys(store.deleted), fmt.Sprintf("uploads/%[1]s/%[2]s/original,products/%[1]s/%[2]s/400.jpg,products/%[1]s/%[2]s/800.jpg", imgProductID, imgID))
	})
	t.Run("a file that cannot be deleted is only logged", func(t *testing.T) {
		repo := newFakeImageRepo(ready)
		store := newFakeStore()
		store.deleteErr = errStore
		ctx, logs := logged()
		err := NewImageService(repo, store).Delete(ctx, imgProductID, imgID)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(store.deleted), 3, "every key is tried")
		testx.AssertEqual(t, strings.Count(logs.String(), `"msg":"delete image file"`), 3)
	})
	t.Run("storage disabled", func(t *testing.T) {
		repo := newFakeImageRepo(ready)
		err := NewImageService(repo, nil).Delete(context.Background(), imgProductID, imgID)
		testx.AssertTrue(t, errors.Is(err, ErrStorageDisabled))
		testx.AssertEqual(t, len(repo.deleted), 0)
	})
	t.Run("unknown image", func(t *testing.T) {
		repo := newFakeImageRepo()
		store := newFakeStore()
		err := NewImageService(repo, store).Delete(context.Background(), imgProductID, imgID)
		testx.AssertTrue(t, errors.Is(err, ErrImageNotFound), "err = %v", err)
		testx.AssertEqual(t, len(repo.deleted)+len(store.deleted), 0)
	})
	t.Run("the row delete fails: the files stay", func(t *testing.T) {
		repo := newFakeImageRepo(ready)
		repo.deleteErr = errBoom
		store := newFakeStore()
		err := NewImageService(repo, store).Delete(context.Background(), imgProductID, imgID)
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, len(store.deleted), 0, "the row still links to them")
	})
}

func mustBase64(t *testing.T, s string) []byte {
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(s)
	testx.AssertNoError(t, err)
	return b
}
