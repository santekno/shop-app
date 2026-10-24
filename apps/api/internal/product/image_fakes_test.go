package product

// Fakes for the ImageService tests (Bab 6 artikel-05, used again by
// artikel-06 and artikel-07): an ImageRepository and an ObjectStore that
// record every call and answer from their fields, and small image files.

import (
	"bytes"
	"context"
	"database/sql/driver"
	"encoding/binary"
	"errors"
	"fmt"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/storage"
)

const (
	imgProductID = "0190c8a0-0000-7000-8000-0000000000a1"
	imgID        = "0190c8a0-0000-7000-8000-0000000000b1"
	imgID2       = "0190c8a0-0000-7000-8000-0000000000b2"
	imgID3       = "0190c8a0-0000-7000-8000-0000000000b3"
)

type createCall struct {
	productID, contentType string
	size                   int32
}

type confirmCall struct {
	img    Image
	status string
}

type finishCall struct {
	id, status string
	variants   []ImageVariant
}

type staleCall struct {
	before time.Time
	limit  int32
}

// fakeImageRepo is an ImageRepository on a map of images by ID.
type fakeImageRepo struct {
	mu sync.Mutex

	created   []createCall
	createImg Image
	createErr error

	images   map[string]Image
	getCalls int
	getErrs  []error // returned by the GetImage calls in order, then nil

	confirmed  []confirmCall
	confirmErr error

	deleted   []string
	deleteErr error

	processing      []Image
	processingErr   error
	processingLimit int32

	finished   []finishCall
	finishErrs map[string]error

	staleBatches [][]string
	staleErrAt   int // the stale call (1-based) that fails with staleErr
	staleErr     error
	staleCalls   []staleCall
}

func newFakeImageRepo(images ...Image) *fakeImageRepo {
	f := &fakeImageRepo{images: map[string]Image{}, finishErrs: map[string]error{}}
	for _, img := range images {
		f.images[img.ID] = img
	}
	return f
}

func (f *fakeImageRepo) CreatePendingImage(_ context.Context, productID, contentType string, size int32) (Image, error) {
	f.created = append(f.created, createCall{productID: productID, contentType: contentType, size: size})
	return f.createImg, f.createErr
}

func (f *fakeImageRepo) GetImage(_ context.Context, productID, imageID string) (Image, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getCalls++
	if len(f.getErrs) > 0 {
		err := f.getErrs[0]
		f.getErrs = f.getErrs[1:]
		if err != nil {
			return Image{}, err
		}
	}
	img, ok := f.images[imageID]
	if !ok || img.ProductID != productID {
		return Image{}, ErrImageNotFound
	}
	return img, nil
}

func (f *fakeImageRepo) ConfirmImage(_ context.Context, img Image, status string) error {
	f.confirmed = append(f.confirmed, confirmCall{img: img, status: status})
	if f.confirmErr != nil {
		return f.confirmErr
	}
	img.Status = status
	f.images[img.ID] = img
	return nil
}

func (f *fakeImageRepo) DeleteImage(_ context.Context, productID, imageID string) error {
	f.deleted = append(f.deleted, productID+"/"+imageID)
	if f.deleteErr != nil {
		return f.deleteErr
	}
	delete(f.images, imageID)
	return nil
}

func (f *fakeImageRepo) ProcessingImages(_ context.Context, limit int32) ([]Image, error) {
	f.processingLimit = limit
	return f.processing, f.processingErr
}

func (f *fakeImageRepo) DeleteStalePendingImages(_ context.Context, before time.Time, limit int32) ([]string, error) {
	f.staleCalls = append(f.staleCalls, staleCall{before: before, limit: limit})
	if len(f.staleCalls) == f.staleErrAt {
		return nil, f.staleErr
	}
	if len(f.staleBatches) == 0 {
		return nil, nil
	}
	keys := f.staleBatches[0]
	f.staleBatches = f.staleBatches[1:]
	return keys, nil
}

func (f *fakeImageRepo) FinishImage(_ context.Context, id, status string, variants []ImageVariant) error {
	f.finished = append(f.finished, finishCall{id: id, status: status, variants: variants})
	return f.finishErrs[id]
}

type storeObject struct {
	data        []byte
	contentType string
}

type presignCall struct {
	key, contentType string
	size             int64
	ttl              time.Duration
}

type putCall struct {
	key, contentType string
	data             []byte
}

// fakeStore is an ObjectStore on a map of objects by key.
type fakeStore struct {
	objects map[string]storeObject

	presigns   []presignCall
	presignErr error

	statKeys []string
	statErr  error

	getKeys []string
	getErrs map[string]error
	closed  int

	puts    []putCall
	putErrs map[string]error

	deleted   []string
	deleteErr error
}

func newFakeStore() *fakeStore {
	return &fakeStore{objects: map[string]storeObject{}, getErrs: map[string]error{}, putErrs: map[string]error{}}
}

func (s *fakeStore) with(key, contentType string, data []byte) *fakeStore {
	s.objects[key] = storeObject{data: data, contentType: contentType}
	return s
}

func (s *fakeStore) PresignPut(_ context.Context, key, contentType string, size int64, ttl time.Duration) (storage.PresignedUpload, error) {
	s.presigns = append(s.presigns, presignCall{key: key, contentType: contentType, size: size, ttl: ttl})
	if s.presignErr != nil {
		return storage.PresignedUpload{}, s.presignErr
	}
	return storage.PresignedUpload{
		URL:       "https://uploads.test/goshop/" + key + "?X-Amz-Signature=sig",
		Headers:   map[string]string{"Content-Type": contentType, "Content-Length": fmt.Sprint(size)},
		ExpiresAt: time.Date(2026, 10, 24, 10, 15, 0, 0, time.UTC),
	}, nil
}

func (s *fakeStore) Stat(_ context.Context, key string) (storage.ObjectInfo, error) {
	s.statKeys = append(s.statKeys, key)
	if s.statErr != nil {
		return storage.ObjectInfo{}, s.statErr
	}
	obj, ok := s.objects[key]
	if !ok {
		return storage.ObjectInfo{}, fmt.Errorf("storage: %s: %w", key, storage.ErrNotFound)
	}
	return storage.ObjectInfo{Size: int64(len(obj.data)), ContentType: obj.contentType}, nil
}

func (s *fakeStore) Get(_ context.Context, key string) (io.ReadCloser, error) {
	s.getKeys = append(s.getKeys, key)
	if err := s.getErrs[key]; err != nil {
		return nil, err
	}
	obj, ok := s.objects[key]
	if !ok {
		return nil, fmt.Errorf("storage: %s: %w", key, storage.ErrNotFound)
	}
	return &closeCounter{Reader: bytes.NewReader(obj.data), s: s}, nil
}

func (s *fakeStore) Delete(_ context.Context, key string) error {
	s.deleted = append(s.deleted, key)
	if s.deleteErr != nil {
		return s.deleteErr
	}
	delete(s.objects, key)
	return nil
}

func (s *fakeStore) Put(_ context.Context, key, contentType string, r io.Reader) (string, error) {
	data, err := io.ReadAll(r)
	if err != nil {
		return "", fmt.Errorf("read: %w", err)
	}
	s.puts = append(s.puts, putCall{key: key, contentType: contentType, data: data})
	if err := s.putErrs[key]; err != nil {
		return "", err
	}
	s.objects[key] = storeObject{data: data, contentType: contentType}
	return s.PublicURL(key), nil
}

func (s *fakeStore) PublicURL(key string) string { return "https://cdn.test/" + key }

type closeCounter struct {
	io.Reader
	s *fakeStore
}

func (c *closeCounter) Close() error {
	c.s.closed++
	return nil
}

// pngHeader is a PNG's signature and IHDR chunk only, for a w×h RGBA
// image: enough for image.DecodeConfig, without encoding the pixels of a
// huge image.
func pngHeader(w, h uint32) []byte {
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 6 // 8-bit RGBA
	chunk := append([]byte("IHDR"), ihdr...)
	_ = binary.Write(&b, binary.BigEndian, uint32(13)) // the IHDR length
	b.Write(chunk)
	_ = binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(chunk))
	return b.Bytes()
}

// jpegOf is a real w×h JPEG.
func jpegOf(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 90, A: 255}) // #nosec G115 -- test pattern
		}
	}
	var b bytes.Buffer
	testx.AssertNoError(t, jpeg.Encode(&b, img, &jpeg.Options{Quality: 80}))
	return b.Bytes()
}

// pendingImage is a pending upload of data as contentType, its declared
// size the data's length.
func pendingImage(id, contentType string, data []byte) Image {
	return Image{
		ID: id, ProductID: imgProductID, Position: 0, Status: ImagePendingUpload, ContentType: contentType,
		SizeBytes: int32(len(data)), OriginalKey: ImageKey(imgProductID, id), // #nosec G115 -- small test files
	}
}

// logged returns a context whose logger writes JSON lines into the
// returned buffer.
func logged() (context.Context, *bytes.Buffer) {
	var buf bytes.Buffer
	return logx.WithContextLogger(context.Background(), logx.New(logx.WithOutput(&buf), logx.WithLevel("debug"))), &buf
}

var errStore = errors.New("s3 unavailable")

func joinKeys(keys []string) string { return strings.Join(keys, ",") }

// imageRow is a product_images row in its column order (sqlc ProductImage).
func imageRow(id, productID, status string, position int16, variants string) []driver.Value {
	var w, h driver.Value
	if status != ImagePendingUpload {
		w, h = int64(1000), int64(750)
	}
	return []driver.Value{
		id, productID, int64(position), "alt " + id, status, "image/jpeg", int64(2048), ImageKey(productID, id),
		w, h, imgCreated, imgCreated, []byte(variants),
	}
}

const twoVariants = `[{"width":400,"height":300,"key":"k400"},{"width":800,"height":600,"key":"k800"}]`
