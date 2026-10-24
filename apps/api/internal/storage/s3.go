// Package storage is GoShop's S3 object storage (ADR 0003, ADR 0007):
// SeaweedFS locally, any S3-compatible bucket in production. S3
// implements sdk storagex.Storage, plus what the sdk does not have:
// presigned uploads, object metadata and public URLs (docs/sdk-gaps.md).
package storage

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
	"github.com/santekno/sdk/storagex"
)

// ErrNotFound means there is no object under the key.
var ErrNotFound = errors.New("object not found")

// Config is where the bucket is and how to reach it.
type Config struct {
	// Endpoint is how the API and the worker reach S3, e.g.
	// http://storage:8333 inside Docker Compose.
	Endpoint string
	// PresignEndpoint is the S3 endpoint a browser or phone uploads to,
	// e.g. http://localhost:8333 locally; the presigned URL is signed for
	// this host. Empty means Endpoint.
	PresignEndpoint string
	// PublicURL is the base URL objects are read from by the public
	// (a CDN or the bucket's public domain), without a trailing slash.
	// Empty means PresignEndpoint/Bucket.
	PublicURL string
	Region    string
	Bucket    string
	AccessKey string
	SecretKey string
}

// S3 is one bucket.
type S3 struct {
	client    *minio.Client // Endpoint: reads, writes, deletes
	presigner *minio.Client // PresignEndpoint: signs URLs, never connects
	bucket    string
	region    string
	publicURL string
}

var _ storagex.Storage = (*S3)(nil)

// New returns the bucket of cfg. It makes no network call.
func New(cfg Config) (*S3, error) {
	if cfg.PresignEndpoint == "" {
		cfg.PresignEndpoint = cfg.Endpoint
	}
	if cfg.PublicURL == "" {
		cfg.PublicURL = strings.TrimRight(cfg.PresignEndpoint, "/") + "/" + cfg.Bucket
	}
	client, err := newClient(cfg.Endpoint, cfg)
	if err != nil {
		return nil, err
	}
	presigner, err := newClient(cfg.PresignEndpoint, cfg)
	if err != nil {
		return nil, err
	}
	return &S3{
		client: client, presigner: presigner, bucket: cfg.Bucket, region: cfg.Region,
		publicURL: strings.TrimRight(cfg.PublicURL, "/"),
	}, nil
}

// newClient is a minio client for endpoint (scheme://host[:port]). The
// region is set, so presigning needs no GetBucketLocation call.
func newClient(endpoint string, cfg Config) (*minio.Client, error) {
	u, err := url.Parse(endpoint)
	if err != nil || u.Host == "" {
		return nil, fmt.Errorf("storage: endpoint %q is not a URL like http://localhost:8333", endpoint)
	}
	c, err := minio.New(u.Host, &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKey, cfg.SecretKey, ""),
		Secure: u.Scheme == "https",
		Region: cfg.Region,
	})
	if err != nil {
		return nil, fmt.Errorf("storage: client for %s: %w", u.Host, err)
	}
	return c, nil
}

// EnsureBucket creates the bucket when it does not exist yet. `api
// migrate` calls it, so `make up` needs no manual step; in production the
// bucket usually exists and this is one HEAD request.
func (s *S3) EnsureBucket(ctx context.Context) error {
	exists, err := s.client.BucketExists(ctx, s.bucket)
	if err != nil {
		return fmt.Errorf("storage: check bucket %s: %w", s.bucket, err)
	}
	if exists {
		return nil
	}
	if err := s.client.MakeBucket(ctx, s.bucket, minio.MakeBucketOptions{Region: s.region}); err != nil {
		return fmt.Errorf("storage: create bucket %s: %w", s.bucket, err)
	}
	return nil
}

// PresignedUpload is a URL a client PUTs one object to, with the headers
// it must send exactly as given: they are part of the signature.
type PresignedUpload struct {
	URL       string
	Headers   map[string]string
	ExpiresAt time.Time
}

// PresignPut signs a PUT of exactly size bytes of contentType under key,
// valid for ttl. Content-Type and Content-Length are signed headers, so an
// upload of another type or size fails the signature check at S3; the
// caller checks the object again afterwards anyway (Stat), because not
// every S3-compatible store enforces every signed header.
func (s *S3) PresignPut(ctx context.Context, key, contentType string, size int64, ttl time.Duration) (PresignedUpload, error) {
	headers := http.Header{}
	headers.Set("Content-Type", contentType)
	headers.Set("Content-Length", strconv.FormatInt(size, 10))
	u, err := s.presigner.PresignHeader(ctx, http.MethodPut, s.bucket, key, ttl, nil, headers)
	if err != nil {
		return PresignedUpload{}, fmt.Errorf("storage: presign %s: %w", key, err)
	}
	return PresignedUpload{
		URL:       u.String(),
		Headers:   map[string]string{"Content-Type": contentType, "Content-Length": strconv.FormatInt(size, 10)},
		ExpiresAt: time.Now().Add(ttl),
	}, nil
}

// ObjectInfo is what S3 knows about an object.
type ObjectInfo struct {
	Size        int64
	ContentType string
}

// Stat returns key's size and content type, or ErrNotFound.
func (s *S3) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	info, err := s.client.StatObject(ctx, s.bucket, key, minio.StatObjectOptions{})
	if err != nil {
		return ObjectInfo{}, notFound(err, key)
	}
	return ObjectInfo{Size: info.Size, ContentType: info.ContentType}, nil
}

// Put implements storagex.Storage: it writes r under key and returns the
// object's public URL. A *bytes.Reader (or anything with Len) is sent with
// its length; anything else is streamed.
func (s *S3) Put(ctx context.Context, key, contentType string, r io.Reader) (string, error) {
	size := int64(-1)
	if l, ok := r.(interface{ Len() int }); ok {
		size = int64(l.Len())
	}
	_, err := s.client.PutObject(ctx, s.bucket, key, r, size, minio.PutObjectOptions{
		ContentType: contentType,
		// Keys are never reused (a new image gets a new id), so the
		// public copy can be cached for a year.
		CacheControl: "public, max-age=31536000, immutable",
	})
	if err != nil {
		return "", fmt.Errorf("storage: put %s: %w", key, err)
	}
	return s.PublicURL(key), nil
}

// Get implements storagex.Storage. The caller closes the reader. A missing
// key is ErrNotFound (on the first read for minio's lazy objects, so Get
// checks it first).
func (s *S3) Get(ctx context.Context, key string) (io.ReadCloser, error) {
	obj, err := s.client.GetObject(ctx, s.bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, notFound(err, key)
	}
	if _, err := obj.Stat(); err != nil {
		_ = obj.Close()
		return nil, notFound(err, key)
	}
	return obj, nil
}

// Delete implements storagex.Storage. Deleting a missing key is not an
// error.
func (s *S3) Delete(ctx context.Context, key string) error {
	if err := s.client.RemoveObject(ctx, s.bucket, key, minio.RemoveObjectOptions{}); err != nil {
		return fmt.Errorf("storage: delete %s: %w", key, err)
	}
	return nil
}

// PublicURL is where the public reads key.
func (s *S3) PublicURL(key string) string { return s.publicURL + "/" + key }

func notFound(err error, key string) error {
	if code := minio.ToErrorResponse(err).Code; code == "NoSuchKey" || code == "NotFound" {
		return fmt.Errorf("storage: %s: %w", key, ErrNotFound)
	}
	return fmt.Errorf("storage: %s: %w", key, err)
}
