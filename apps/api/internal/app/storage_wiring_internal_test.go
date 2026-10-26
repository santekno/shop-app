package app

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/product"
)

// validStorage is an S3 configuration; building its client makes no
// network call.
func validStorage() config.Storage {
	return config.Storage{
		Endpoint: "http://storage:8333", PresignEndpoint: "http://localhost:8333", Region: "us-east-1",
		Bucket: "goshop-images", AccessKey: "test-access", SecretKey: "test-secret",
	}
}

func TestObjectStore(t *testing.T) {
	t.Run("no endpoint: uploads off", func(t *testing.T) {
		s, err := ObjectStore(config.Storage{Bucket: "goshop-images"})
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, s == nil, "store %v, want nil", s)
	})
	t.Run("public URL defaults to the presign endpoint and bucket", func(t *testing.T) {
		s, err := ObjectStore(validStorage())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, s.PublicURL("products/p/i/400w.jpg"), "http://localhost:8333/goshop-images/products/p/i/400w.jpg")
	})
	t.Run("a public URL is used as given", func(t *testing.T) {
		cfg := validStorage()
		cfg.PublicURL = "https://img.shop.test"
		s, err := ObjectStore(cfg)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, s.PublicURL("products/p/i/800w.jpg"), "https://img.shop.test/products/p/i/800w.jpg")
	})
	for _, endpoint := range []string{"not a url", "http://"} {
		t.Run("bad endpoint "+endpoint, func(t *testing.T) {
			cfg := validStorage()
			cfg.Endpoint = endpoint
			s, err := ObjectStore(cfg)
			if err == nil {
				t.Fatal("want an error, got nil")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "image storage: "), "err = %v", err)
			testx.AssertTrue(t, s == nil, "no store with an error")
			testx.AssertFalse(t, strings.Contains(err.Error(), "test-secret"), "the secret key is never repeated")
		})
	}
}

func TestProcessImages(t *testing.T) {
	t.Run("uploads off: nothing to do", func(t *testing.T) {
		logger, logs := jsonLogger()
		db := &recordingDB{}
		testx.AssertNoError(t, processImages(config.Storage{})(context.Background(), db.open(t), logger))
		testx.AssertContains(t, logs.String(), `"level":"WARN","msg":"image uploads are off: S3_ENDPOINT is not set; nothing to process"`)
		testx.AssertEqual(t, len(db.queries()), 0, "the database is not asked")
	})
	t.Run("bad endpoint", func(t *testing.T) {
		logger, _ := jsonLogger()
		cfg := validStorage()
		cfg.Endpoint = "not a url"
		db := &recordingDB{}
		err := processImages(cfg)(context.Background(), db.open(t), logger)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "image storage: "), "err = %v", err)
		testx.AssertEqual(t, len(db.queries()), 0)
	})
	t.Run("nothing waiting", func(t *testing.T) {
		logger, logs := jsonLogger()
		db := &recordingDB{}
		testx.AssertNoError(t, processImages(validStorage())(context.Background(), db.open(t), logger))
		testx.AssertEqual(t, strings.Join(db.queries(), ","), "ListProcessingImages")
		testx.AssertEqual(t, len(db.args[0]), 1)
		testx.AssertEqual(t, db.args[0][0], any(int32(product.ProcessBatchSize)))
		testx.AssertContains(t, logs.String(), `"msg":"processed product images","finished":0`)
	})
	t.Run("the database fails", func(t *testing.T) {
		logger, logs := jsonLogger()
		errDown := errors.New("database down")
		err := processImages(validStorage())(context.Background(), (&recordingDB{err: errDown}).open(t), logger)
		testx.AssertTrue(t, errors.Is(err, errDown), "err = %v", err)
		testx.AssertContains(t, logs.String(), `"msg":"processed product images","finished":0`)
	})
}
