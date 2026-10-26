package storage

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// fakeS3 is a loopback S3 for minio-go (path-style, as minio-go talks to
// any host that is not AWS): it records every request and answers with
// respond, so a test scripts what the bucket says and checks what S3 sent.
type fakeS3 struct {
	mu       sync.Mutex
	requests []s3Request
	respond  func(w http.ResponseWriter, r s3Request)
}

// s3Request is one request the fake received, with its body read.
type s3Request struct {
	Method string
	Path   string
	Query  url.Values
	Header http.Header
	Body   []byte
}

func newFakeS3(t *testing.T, respond func(w http.ResponseWriter, r s3Request)) (*fakeS3, *httptest.Server) {
	t.Helper()
	f := &fakeS3{respond: respond}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		req := s3Request{Method: r.Method, Path: r.URL.Path, Query: r.URL.Query(), Header: r.Header.Clone(), Body: body}
		f.mu.Lock()
		f.requests = append(f.requests, req)
		f.mu.Unlock()
		f.respond(w, req)
	}))
	t.Cleanup(srv.Close)
	return f, srv
}

func (f *fakeS3) all() []s3Request {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]s3Request(nil), f.requests...)
}

// methods lists "METHOD path" of every request, in order.
func (f *fakeS3) methods() string {
	var out []string
	for _, r := range f.all() {
		out = append(out, r.Method+" "+r.Path)
	}
	return strings.Join(out, ",")
}

func newTestS3(t *testing.T, srv *httptest.Server) *S3 {
	t.Helper()
	s, err := New(Config{Endpoint: srv.URL, Bucket: "goshop", Region: "us-east-1", AccessKey: "goshop", SecretKey: "goshop-secret"})
	testx.AssertNoError(t, err)
	return s
}

// objectHeaders are the headers S3 answers a HEAD or GET of an object
// with; minio-go needs Last-Modified to build its ObjectInfo.
func objectHeaders(w http.ResponseWriter, size int, contentType string) {
	w.Header().Set("Content-Length", strconv.Itoa(size))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("ETag", `"d41d8cd98f00b204e9800998ecf8427e"`)
	w.Header().Set("Last-Modified", time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC).Format(http.TimeFormat))
}

func s3Error(w http.ResponseWriter, status int, code string) {
	w.Header().Set("Content-Type", "application/xml")
	w.WriteHeader(status)
	_, _ = io.WriteString(w, `<?xml version="1.0" encoding="UTF-8"?><Error><Code>`+code+`</Code><Message>`+code+`</Message></Error>`)
}

func TestNew(t *testing.T) {
	t.Run("an endpoint without scheme and host is refused", func(t *testing.T) {
		for _, endpoint := range []string{"", "localhost:8333", "storage", "://bad"} {
			_, err := New(Config{Endpoint: endpoint, Bucket: "goshop", Region: "us-east-1"})
			testx.AssertError(t, err, endpoint)
			testx.AssertContains(t, err.Error(), "is not a URL like http://localhost:8333")
		}
	})
	t.Run("a bad presign endpoint is refused too", func(t *testing.T) {
		_, err := New(Config{Endpoint: "http://storage:8333", PresignEndpoint: "localhost:8333", Bucket: "goshop"})
		testx.AssertError(t, err)
		testx.AssertContains(t, err.Error(), `"localhost:8333"`)
	})
	t.Run("the public URL defaults to the presign endpoint and the bucket", func(t *testing.T) {
		s, err := New(Config{Endpoint: "http://storage:8333", PresignEndpoint: "http://localhost:8333/", Bucket: "goshop", Region: "us-east-1"})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, s.PublicURL("products/p/i/400.jpg"), "http://localhost:8333/goshop/products/p/i/400.jpg")
	})
	t.Run("the presign endpoint defaults to the endpoint", func(t *testing.T) {
		s, err := New(Config{Endpoint: "http://storage:8333", Bucket: "goshop", Region: "us-east-1", AccessKey: "a", SecretKey: "b"})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, s.PublicURL("k"), "http://storage:8333/goshop/k")
		up, err := s.PresignPut(context.Background(), "k", "image/png", 1, time.Minute)
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(up.URL, "http://storage:8333/goshop/k?"), up.URL)
	})
	t.Run("an explicit public URL loses its trailing slash", func(t *testing.T) {
		s, err := New(Config{Endpoint: "http://storage:8333", PublicURL: "https://cdn.goshop.test/", Bucket: "goshop", Region: "us-east-1"})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, s.PublicURL("products/a/b/800.jpg"), "https://cdn.goshop.test/products/a/b/800.jpg")
	})
}

func TestS3_PresignPut(t *testing.T) {
	s, err := New(Config{
		Endpoint: "http://storage:8333", PresignEndpoint: "https://uploads.goshop.test",
		Bucket: "goshop", Region: "us-east-1", AccessKey: "goshop", SecretKey: "goshop-secret",
	})
	testx.AssertNoError(t, err)
	before := time.Now()

	up, err := s.PresignPut(context.Background(), "products/p1/i1/original", "image/png", 2048, 15*time.Minute)

	testx.AssertNoError(t, err)
	u, err := url.Parse(up.URL)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, u.Scheme, "https")
	testx.AssertEqual(t, u.Host, "uploads.goshop.test", "signed for the host the browser uploads to, not the API's endpoint")
	testx.AssertEqual(t, u.Path, "/goshop/products/p1/i1/original")
	q := u.Query()
	signed := strings.Split(q.Get("X-Amz-SignedHeaders"), ";")
	for _, h := range []string{"content-length", "content-type", "host"} {
		testx.AssertTrue(t, containsString(signed, h), "%s is not signed: %v", h, signed)
	}
	testx.AssertEqual(t, q.Get("X-Amz-Expires"), "900")
	testx.AssertEqual(t, q.Get("X-Amz-Algorithm"), "AWS4-HMAC-SHA256")
	testx.AssertContains(t, q.Get("X-Amz-Credential"), "goshop/")
	testx.AssertContains(t, q.Get("X-Amz-Credential"), "/us-east-1/s3/aws4_request")
	testx.AssertEqual(t, len(up.Headers), 2)
	testx.AssertEqual(t, up.Headers["Content-Type"], "image/png")
	testx.AssertEqual(t, up.Headers["Content-Length"], "2048")
	testx.AssertFalse(t, up.ExpiresAt.Before(before.Add(15*time.Minute)), "expires %v", up.ExpiresAt)
	testx.AssertFalse(t, up.ExpiresAt.After(time.Now().Add(15*time.Minute)), "expires %v", up.ExpiresAt)
}

func TestS3_PresignPut_Error(t *testing.T) {
	// No credentials: minio-go refuses to sign, and nothing is returned.
	s, err := New(Config{Endpoint: "http://storage:8333", Bucket: "goshop", Region: "us-east-1"})
	testx.AssertNoError(t, err)
	up, err := s.PresignPut(context.Background(), "products/p/i/original", "image/png", 1, time.Minute)
	testx.AssertError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(err.Error(), "storage: presign products/p/i/original: "), err.Error())
	testx.AssertEqual(t, up.URL, "")
	testx.AssertTrue(t, up.Headers == nil)
}

// The signature binds the declared size and type: the same key signed in
// the same second for another size or type is another signature.
func TestS3_PresignPut_SignatureBindsSizeAndType(t *testing.T) {
	s, err := New(Config{Endpoint: "http://storage:8333", Bucket: "goshop", Region: "us-east-1", AccessKey: "a", SecretKey: "b"})
	testx.AssertNoError(t, err)
	sign := func(contentType string, size int64) (date, signature string) {
		up, err := s.PresignPut(context.Background(), "k", contentType, size, time.Minute)
		testx.AssertNoError(t, err)
		u, err := url.Parse(up.URL)
		testx.AssertNoError(t, err)
		return u.Query().Get("X-Amz-Date"), u.Query().Get("X-Amz-Signature")
	}
	for range 3 { // X-Amz-Date has a resolution of one second
		d1, png10 := sign("image/png", 10)
		d2, png11 := sign("image/png", 11)
		d3, jpeg10 := sign("image/jpeg", 10)
		d4, again := sign("image/png", 10)
		if d1 != d2 || d1 != d3 || d1 != d4 {
			continue
		}
		testx.AssertEqual(t, png10, again, "same request, same signature")
		testx.AssertNotEqual(t, png10, png11, "the size is signed")
		testx.AssertNotEqual(t, png10, jpeg10, "the content type is signed")
		return
	}
	t.Fatal("could not sign four URLs within one second")
}

func TestS3_Stat(t *testing.T) {
	tests := []struct {
		name     string
		respond  func(w http.ResponseWriter, r s3Request)
		want     ObjectInfo
		notFound bool
		wantErr  bool
	}{
		{
			name:    "size and content type",
			respond: func(w http.ResponseWriter, _ s3Request) { objectHeaders(w, 1234, "image/webp") },
			want:    ObjectInfo{Size: 1234, ContentType: "image/webp"},
		},
		{name: "missing", respond: func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusNotFound) }, notFound: true, wantErr: true},
		{name: "forbidden", respond: func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusForbidden) }, wantErr: true},
		{name: "bad request", respond: func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusBadRequest) }, wantErr: true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f, srv := newFakeS3(t, tt.respond)
			got, err := newTestS3(t, srv).Stat(context.Background(), "products/p/i/original")
			testx.AssertEqual(t, f.methods(), "HEAD /goshop/products/p/i/original")
			testx.AssertEqual(t, errors.Is(err, ErrNotFound), tt.notFound, "err = %v", err)
			if tt.wantErr {
				testx.AssertError(t, err)
				testx.AssertContains(t, err.Error(), "storage: products/p/i/original: ")
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got, tt.want)
		})
	}
}

func TestS3_Delete(t *testing.T) {
	t.Run("deleted", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusNoContent) })
		err := newTestS3(t, srv).Delete(context.Background(), "products/p/i/400.jpg")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, f.methods(), "DELETE /goshop/products/p/i/400.jpg")
	})
	t.Run("refused", func(t *testing.T) {
		_, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { s3Error(w, http.StatusForbidden, "AccessDenied") })
		err := newTestS3(t, srv).Delete(context.Background(), "products/p/i/400.jpg")
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "storage: delete products/p/i/400.jpg: "), err.Error())
		testx.AssertFalse(t, errors.Is(err, ErrNotFound))
	})
}

func TestS3_Put(t *testing.T) {
	t.Run("stored with a year of caching", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) {
			w.Header().Set("ETag", `"abc"`)
			w.WriteHeader(http.StatusOK)
		})
		s := newTestS3(t, srv)
		got, err := s.Put(context.Background(), "products/p/i/800.jpg", "image/jpeg", strings.NewReader("jpeg bytes"))
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, got, srv.URL+"/goshop/products/p/i/800.jpg")
		reqs := f.all()
		testx.AssertEqual(t, len(reqs), 1)
		r := reqs[0]
		testx.AssertEqual(t, r.Method, http.MethodPut)
		testx.AssertEqual(t, r.Path, "/goshop/products/p/i/800.jpg")
		testx.AssertEqual(t, r.Header.Get("Content-Type"), "image/jpeg")
		testx.AssertEqual(t, r.Header.Get("Cache-Control"), "public, max-age=31536000, immutable")
		// minio-go signs the body in aws-chunked frames; the object's size
		// is the decoded length, known up front for a reader with Len.
		testx.AssertEqual(t, r.Header.Get("X-Amz-Decoded-Content-Length"), "10", "a reader with Len is sent with its length")
		testx.AssertContains(t, string(r.Body), "jpeg bytes")
	})
	t.Run("refused", func(t *testing.T) {
		_, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { s3Error(w, http.StatusForbidden, "AccessDenied") })
		got, err := newTestS3(t, srv).Put(context.Background(), "k.jpg", "image/jpeg", strings.NewReader("x"))
		testx.AssertError(t, err)
		testx.AssertEqual(t, got, "")
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "storage: put k.jpg: "), err.Error())
	})
}

func TestS3_Get(t *testing.T) {
	t.Run("readable", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) {
			objectHeaders(w, 5, "image/png")
			_, _ = io.WriteString(w, "hello")
		})
		rc, err := newTestS3(t, srv).Get(context.Background(), "products/p/i/original")
		testx.AssertNoError(t, err)
		defer func() { _ = rc.Close() }()
		b, err := io.ReadAll(rc)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, string(b), "hello")
		// Get checks the object first, so a missing key fails at Get, not
		// on the first read.
		testx.AssertEqual(t, f.methods(), "HEAD /goshop/products/p/i/original,GET /goshop/products/p/i/original")
	})
	t.Run("missing is ErrNotFound at once", func(t *testing.T) {
		_, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { s3Error(w, http.StatusNotFound, "NoSuchKey") })
		rc, err := newTestS3(t, srv).Get(context.Background(), "gone")
		testx.AssertTrue(t, errors.Is(err, ErrNotFound), "err = %v", err)
		testx.AssertTrue(t, rc == nil)
	})
	t.Run("forbidden is another error", func(t *testing.T) {
		_, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { s3Error(w, http.StatusForbidden, "AccessDenied") })
		rc, err := newTestS3(t, srv).Get(context.Background(), "secret")
		testx.AssertError(t, err)
		testx.AssertFalse(t, errors.Is(err, ErrNotFound))
		testx.AssertTrue(t, rc == nil)
	})
	t.Run("an invalid key fails before any request", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusOK) })
		rc, err := newTestS3(t, srv).Get(context.Background(), "")
		testx.AssertError(t, err)
		testx.AssertTrue(t, rc == nil)
		testx.AssertEqual(t, len(f.all()), 0)
	})
}

func TestS3_EnsureBucket(t *testing.T) {
	t.Run("an existing bucket is left alone", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusOK) })
		testx.AssertNoError(t, newTestS3(t, srv).EnsureBucket(context.Background()))
		testx.AssertEqual(t, f.methods(), "HEAD /goshop/")
	})
	t.Run("a missing bucket is created", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, r s3Request) {
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
		testx.AssertNoError(t, newTestS3(t, srv).EnsureBucket(context.Background()))
		testx.AssertEqual(t, f.methods(), "HEAD /goshop/,PUT /goshop/")
	})
	t.Run("the check fails", func(t *testing.T) {
		f, srv := newFakeS3(t, func(w http.ResponseWriter, _ s3Request) { w.WriteHeader(http.StatusForbidden) })
		err := newTestS3(t, srv).EnsureBucket(context.Background())
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "storage: check bucket goshop: "), err.Error())
		testx.AssertEqual(t, f.methods(), "HEAD /goshop/", "no create after a failed check")
	})
	t.Run("the create fails", func(t *testing.T) {
		_, srv := newFakeS3(t, func(w http.ResponseWriter, r s3Request) {
			if r.Method == http.MethodHead {
				w.WriteHeader(http.StatusNotFound)
				return
			}
			s3Error(w, http.StatusForbidden, "AccessDenied")
		})
		err := newTestS3(t, srv).EnsureBucket(context.Background())
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "storage: create bucket goshop: "), err.Error())
	})
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
