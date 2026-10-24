package product

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"image"
	_ "image/jpeg" // registers the formats image.DecodeConfig reads
	_ "image/png"
	"io"
	"net/http"
	"slices"
	"strconv"
	"time"

	"github.com/santekno/sdk/logx"
	_ "golang.org/x/image/webp"

	"github.com/santekno/shop-app/apps/api/internal/imaging"
	"github.com/santekno/shop-app/apps/api/internal/storage"
)

// Product photos (ADR 0007): the seller uploads the file straight to S3
// with a presigned PUT, then confirms it; the API checks what arrived
// before the storefront shows it.

// Image statuses: the product_images_status_check values.
const (
	ImagePendingUpload = "pending_upload"
	ImageProcessing    = "processing"
	ImageReady         = "ready"
	ImageFailed        = "failed"
)

// Upload limits.
const (
	// MaxImagesPerProduct counts pending uploads too.
	MaxImagesPerProduct = 10
	// MaxImageBytes is the largest file: 5 MiB.
	MaxImageBytes = 5 << 20
	// MaxImageSide and MaxImagePixels bound the decoded bitmap: a small
	// file that decodes into a huge image would otherwise fill the
	// worker's memory (a decompression bomb).
	MaxImageSide   = 6000
	MaxImagePixels = 24_000_000
	// UploadTTL is how long a presigned upload URL works.
	UploadTTL = 15 * time.Minute
)

// ImageTypes are the content types a seller may upload.
var ImageTypes = []string{"image/jpeg", "image/png", "image/webp"}

// Image is one photo of a product.
type Image struct {
	ID          string
	ProductID   string
	Position    int16
	Alt         string
	Status      string
	ContentType string
	SizeBytes   int32
	// OriginalKey is the uploaded file's S3 key.
	OriginalKey string
	// Width and Height are the original's pixels; 0 until confirmed.
	Width  int32
	Height int32
	// Variants are the storefront's JPEG copies, narrowest first; empty
	// until the worker has made them.
	Variants  []ImageVariant
	CreatedAt time.Time
	UpdatedAt time.Time
}

// ImageVariant is one resized copy of an image.
type ImageVariant struct {
	Width  int32  `json:"width"`
	Height int32  `json:"height"`
	Key    string `json:"key"`
}

// Largest is the widest variant, which the storefront's url points at;
// false while there is none.
func (img Image) Largest() (ImageVariant, bool) {
	if len(img.Variants) == 0 {
		return ImageVariant{}, false
	}
	return img.Variants[len(img.Variants)-1], true
}

// Upload is a presigned upload of a new image.
type Upload struct {
	Image  Image
	Upload storage.PresignedUpload
}

// Image errors.
var (
	// ErrStorageDisabled: S3_ENDPOINT is not set.
	ErrStorageDisabled = errors.New("image storage is disabled")
	// ErrImageLimit: the product has MaxImagesPerProduct images.
	ErrImageLimit = errors.New("too many images")
	// ErrImageNotFound: the product has no image with that ID.
	ErrImageNotFound = errors.New("image not found")
	// ErrUploadMissing: confirm was called before the file was uploaded.
	ErrUploadMissing = errors.New("upload missing")
)

// UploadInvalidError means the uploaded file is not what was declared, or
// not an acceptable image. The file and the image are deleted.
type UploadInvalidError struct {
	Reason string
}

func (e *UploadInvalidError) Error() string { return "upload invalid: " + e.Reason }

// ObjectStore is the S3 bucket; *storage.S3 is one.
type ObjectStore interface {
	PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (storage.PresignedUpload, error)
	Stat(ctx context.Context, key string) (storage.ObjectInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, error)
	Delete(ctx context.Context, key string) error
	Put(ctx context.Context, key, contentType string, r io.Reader) (string, error)
	PublicURL(key string) string
}

// ImageRepository is where image rows are stored; *PostgresRepository is
// one.
type ImageRepository interface {
	CreatePendingImage(ctx context.Context, productID, contentType string, size int32) (Image, error)
	GetImage(ctx context.Context, productID, imageID string) (Image, error)
	ConfirmImage(ctx context.Context, img Image, status string) error
	DeleteImage(ctx context.Context, productID, imageID string) error
	ProcessingImages(ctx context.Context, limit int32) ([]Image, error)
	FinishImage(ctx context.Context, id, status string, variants []ImageVariant) error
}

// ImageService is the upload flow.
type ImageService struct {
	repo  ImageRepository
	store ObjectStore
}

// NewImageService returns an ImageService; a nil store turns uploads off
// (ErrStorageDisabled).
func NewImageService(repo ImageRepository, store ObjectStore) *ImageService {
	return &ImageService{repo: repo, store: store}
}

// ImageKey is the S3 key of an image's uploaded original. Originals live
// under uploads/, which is never public: the file is the seller's, with
// its metadata (a phone photo's GPS position), and may not even be an
// image until confirm has looked at it. Only what the worker makes, under
// products/, is publicly readable (ADR 0007).
func ImageKey(productID, imageID string) string {
	return "uploads/" + productID + "/" + imageID + "/original"
}

// StartUpload records a pending image of productID and signs a PUT of
// exactly size bytes of contentType for it (both validated by the
// handler). Errors: ErrStorageDisabled, ErrNotFound, ErrImageLimit.
func (s *ImageService) StartUpload(ctx context.Context, productID, contentType string, size int32) (Upload, error) {
	if s.store == nil {
		return Upload{}, ErrStorageDisabled
	}
	img, err := s.repo.CreatePendingImage(ctx, productID, contentType, size)
	if err != nil {
		return Upload{}, fmt.Errorf("start upload: %w", err)
	}
	up, err := s.store.PresignPut(ctx, img.OriginalKey, contentType, int64(size), UploadTTL)
	if err != nil {
		return Upload{}, fmt.Errorf("start upload: %w", err)
	}
	return Upload{Image: img, Upload: up}, nil
}

// Confirm checks the uploaded file of image imageID and hands it to the
// worker (processing) with alt as its text; the worker's ProcessPending
// makes its variants and puts it on the storefront. Confirming twice returns the image
// again. Errors: ErrStorageDisabled, ErrImageNotFound, ErrUploadMissing,
// *UploadInvalidError (the file and the image are deleted).
func (s *ImageService) Confirm(ctx context.Context, productID, imageID, alt string) (Image, error) {
	if s.store == nil {
		return Image{}, ErrStorageDisabled
	}
	img, err := s.repo.GetImage(ctx, productID, imageID)
	if err != nil {
		return Image{}, err
	}
	if img.Status != ImagePendingUpload {
		return img, nil
	}
	width, height, err := s.inspect(ctx, img)
	var invalid *UploadInvalidError
	if errors.As(err, &invalid) {
		s.discard(ctx, img)
		return Image{}, err
	}
	if err != nil {
		return Image{}, err
	}
	img.Alt, img.Width, img.Height = alt, width, height
	if err := s.repo.ConfirmImage(ctx, img, ImageProcessing); err != nil {
		return Image{}, err
	}
	return s.repo.GetImage(ctx, productID, imageID)
}

// inspect checks that the object under img's key is what was declared and
// a real image of an acceptable size, and returns its dimensions. It reads
// only the file's header: a presigned URL promises the request, not the
// bytes.
func (s *ImageService) inspect(ctx context.Context, img Image) (width, height int32, err error) {
	info, err := s.store.Stat(ctx, img.OriginalKey)
	if errors.Is(err, storage.ErrNotFound) {
		return 0, 0, ErrUploadMissing
	}
	if err != nil {
		return 0, 0, fmt.Errorf("confirm image: %w", err)
	}
	if info.Size != int64(img.SizeBytes) {
		return 0, 0, &UploadInvalidError{Reason: "size_mismatch"}
	}
	if info.ContentType != img.ContentType {
		return 0, 0, &UploadInvalidError{Reason: "content_type_mismatch"}
	}
	obj, err := s.store.Get(ctx, img.OriginalKey)
	if err != nil {
		return 0, 0, fmt.Errorf("confirm image: %w", err)
	}
	defer func() { _ = obj.Close() }()
	r := bufio.NewReader(io.LimitReader(obj, MaxImageBytes))
	head, _ := r.Peek(512) // fewer bytes for a tiny file; DetectContentType copes
	if http.DetectContentType(head) != img.ContentType {
		return 0, 0, &UploadInvalidError{Reason: "not_an_image_of_the_declared_type"}
	}
	cfg, _, err := image.DecodeConfig(r)
	if err != nil {
		return 0, 0, &UploadInvalidError{Reason: "unreadable_image"}
	}
	if cfg.Width > MaxImageSide || cfg.Height > MaxImageSide || cfg.Width*cfg.Height > MaxImagePixels {
		return 0, 0, &UploadInvalidError{Reason: "too_many_pixels"}
	}
	return int32(cfg.Width), int32(cfg.Height), nil // #nosec G115 -- at most MaxImageSide
}

// discard deletes a refused upload: the row, then the file. A failure to
// delete the file only leaves an object nobody links to; it is logged.
func (s *ImageService) discard(ctx context.Context, img Image) {
	log := logx.FromContext(ctx)
	if err := s.repo.DeleteImage(ctx, img.ProductID, img.ID); err != nil && !errors.Is(err, ErrImageNotFound) {
		log.Error("delete refused image", "image_id", img.ID, "error", err.Error())
	}
	if err := s.store.Delete(ctx, img.OriginalKey); err != nil {
		log.Warn("delete refused upload", "image_id", img.ID, "error", err.Error())
	}
}

// Delete removes image imageID of productID and its files. Errors:
// ErrStorageDisabled, ErrImageNotFound.
func (s *ImageService) Delete(ctx context.Context, productID, imageID string) error {
	if s.store == nil {
		return ErrStorageDisabled
	}
	img, err := s.repo.GetImage(ctx, productID, imageID)
	if err != nil {
		return err
	}
	if err := s.repo.DeleteImage(ctx, productID, imageID); err != nil {
		return err
	}
	for _, key := range img.Keys() {
		if err := s.store.Delete(ctx, key); err != nil {
			// The row is gone, so nothing links to the file any more.
			logx.FromContext(ctx).Warn("delete image file", "image_id", img.ID, "error", err.Error())
		}
	}
	return nil
}

// Keys lists every S3 key the image owns.
func (img Image) Keys() []string {
	keys := []string{img.OriginalKey}
	for _, v := range img.Variants {
		keys = append(keys, v.Key)
	}
	return keys
}

// AllowedImageType reports whether a seller may upload contentType.
func AllowedImageType(contentType string) bool { return slices.Contains(ImageTypes, contentType) }

// ProcessBatchSize is how many images one ProcessPending run resizes. One
// at a time, so the worker holds one decoded bitmap (at most
// MaxImagePixels × 4 bytes, about 96 MB).
const ProcessBatchSize = 10

// VariantKey is the S3 key of an image's variant of width pixels.
func VariantKey(productID, imageID string, width int) string {
	return "products/" + productID + "/" + imageID + "/" + strconv.Itoa(width) + ".jpg"
}

// ProcessPending makes the variants of up to ProcessBatchSize confirmed
// images, oldest first, and returns how many it finished (ready or
// failed). A file that does not decode fails the image for good; a
// storage error leaves it for the next run. Two runs at once may resize
// the same image: they write the same keys, and only one finishes it.
// `api process-images` runs it once; the worker every 30 seconds.
func (s *ImageService) ProcessPending(ctx context.Context) (int, error) {
	if s.store == nil {
		return 0, ErrStorageDisabled
	}
	images, err := s.repo.ProcessingImages(ctx, ProcessBatchSize)
	if err != nil {
		return 0, err
	}
	done := 0
	for _, img := range images {
		variants, err := s.resize(ctx, img)
		switch {
		case errors.Is(err, imaging.ErrUndecodable):
			logx.FromContext(ctx).Warn("image cannot be processed", "image_id", img.ID, "error", err.Error())
			err = s.repo.FinishImage(ctx, img.ID, ImageFailed, nil)
		case err != nil:
			logx.FromContext(ctx).Warn("process image", "image_id", img.ID, "error", err.Error())
			continue
		default:
			err = s.repo.FinishImage(ctx, img.ID, ImageReady, variants)
		}
		if err != nil && !errors.Is(err, ErrImageNotFound) {
			return done, err
		}
		if err == nil {
			done++
		}
	}
	return done, nil
}

// resize reads img's original, makes its variants and stores them.
func (s *ImageService) resize(ctx context.Context, img Image) ([]ImageVariant, error) {
	obj, err := s.store.Get(ctx, img.OriginalKey)
	if err != nil {
		return nil, fmt.Errorf("read original: %w", err)
	}
	defer func() { _ = obj.Close() }()
	resized, err := imaging.Resize(io.LimitReader(obj, MaxImageBytes), imaging.Widths, MaxImagePixels)
	if err != nil {
		return nil, err
	}
	variants := make([]ImageVariant, 0, len(resized))
	for _, v := range resized {
		key := VariantKey(img.ProductID, img.ID, v.Width)
		if _, err := s.store.Put(ctx, key, "image/jpeg", bytes.NewReader(v.JPEG)); err != nil {
			return nil, fmt.Errorf("store variant: %w", err)
		}
		variants = append(variants, ImageVariant{Width: int32(v.Width), Height: int32(v.Height), Key: key}) // #nosec G115 -- at most MaxImageSide
	}
	return variants, nil
}
