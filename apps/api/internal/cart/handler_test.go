package cart

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// fakeCarts is the handlers' Carts: it records the calls and answers from
// its fields.
type fakeCarts struct {
	calls  []string
	owners []Owner
	qty    int32
	cart   Cart
	token  string
	err    error
	merged [2]string
}

func (f *fakeCarts) record(name string, owner Owner) {
	f.calls = append(f.calls, name)
	f.owners = append(f.owners, owner)
}

func (f *fakeCarts) Get(_ context.Context, owner Owner) (Cart, error) {
	f.record("Get", owner)
	return f.cart, f.err
}

func (f *fakeCarts) Add(_ context.Context, owner Owner, variantID string, quantity int32) (Cart, string, error) {
	f.record("Add "+variantID, owner)
	f.qty = quantity
	return f.cart, f.token, f.err
}

func (f *fakeCarts) SetQuantity(_ context.Context, owner Owner, variantID string, quantity int32) (Cart, error) {
	f.record("SetQuantity "+variantID, owner)
	f.qty = quantity
	return f.cart, f.err
}

func (f *fakeCarts) Remove(_ context.Context, owner Owner, variantID string) (Cart, error) {
	f.record("Remove "+variantID, owner)
	return f.cart, f.err
}

func (f *fakeCarts) Merge(_ context.Context, userID, token string) (Cart, error) {
	f.record("Merge", Owner{UserID: userID, Token: token})
	f.merged = [2]string{userID, token}
	return f.cart, f.err
}

// fakeLimiter refuses the limits in refuse and records every check.
type fakeLimiter struct {
	refuse map[string]time.Duration
	err    error
	checks []string
}

func (l *fakeLimiter) Allow(_ context.Context, limit auth.Limit, key string) (bool, time.Duration, error) {
	l.checks = append(l.checks, limit.Name+":"+key)
	if l.err != nil {
		return false, 0, l.err
	}
	if retry, ok := l.refuse[limit.Name]; ok {
		return false, retry, nil
	}
	return true, 0, nil
}

type handlerEnv struct {
	svc     *fakeCarts
	limiter *fakeLimiter
	router  chi.Router
}

func newHandlerEnv() *handlerEnv {
	env := &handlerEnv{svc: &fakeCarts{cart: oneLineCart()}, limiter: &fakeLimiter{}}
	h := NewHandler(HandlerDeps{Service: env.svc, Validator: httpapi.NewValidator(), Limiter: env.limiter})
	env.router = chi.NewRouter()
	h.Routes(env.router)
	h.ProtectedRoutes(env.router)
	return env
}

// serve sends method path with body, as user (empty: a guest) and with
// header (may be nil).
func (env *handlerEnv) serve(method, path, body, user string, header map[string]string) *httptest.ResponseRecorder {
	ctx := context.Background()
	if user != "" {
		ctx = ctxx.WithUserID(ctx, user)
	}
	req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	env.router.ServeHTTP(rec, req)
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, status, "body %s", rec.Body.String())
	var b errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	testx.AssertEqual(t, b.Error.Code, code, "body %s", rec.Body.String())
	return b
}

// cartBody is a 200 answer of the cart routes.
type cartBody struct {
	Data      JSON    `json:"data"`
	CartToken *string `json:"cart_token"`
}

func decodeCart(t *testing.T, rec *httptest.ResponseRecorder) cartBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	var b cartBody
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return b
}

func addJSON(variantID string, quantity int) string {
	b, _ := json.Marshal(map[string]any{"variant_id": variantID, "quantity": quantity})
	return string(b)
}

func TestHandler_Get(t *testing.T) {
	env := newHandlerEnv()
	b := decodeCart(t, env.serve(http.MethodGet, "/cart", "", userID, nil))
	testx.AssertEqual(t, b.Data.ItemCount, 2)
	testx.AssertEqual(t, b.Data.Subtotal, Rupiah(100000))
	testx.AssertEqual(t, b.Data.Lines[0].VariantID, v1)
	testx.AssertTrue(t, b.CartToken == nil, "no token on a plain read")
	testx.AssertEqual(t, env.svc.owners[0], Owner{UserID: userID})

	// A guest reads the cart of their token.
	env = newHandlerEnv()
	env.serve(http.MethodGet, "/cart", "", "", map[string]string{HeaderToken: "guest.token"})
	testx.AssertEqual(t, env.svc.owners[0], Owner{Token: "guest.token"})
	testx.AssertEqual(t, len(env.limiter.checks), 0, "reading costs no rate limit")
}

func TestHandler_AddItem(t *testing.T) {
	t.Run("a signed-in user", func(t *testing.T) {
		env := newHandlerEnv()
		rec := env.serve(http.MethodPost, "/cart/items", addJSON(v1, 2), userID, nil)
		b := decodeCart(t, rec)
		testx.AssertEqual(t, b.Data.ItemCount, 2)
		testx.AssertTrue(t, b.CartToken == nil)
		testx.AssertEqual(t, rec.Header().Get(HeaderToken), "")
		testx.AssertEqual(t, strings.Join(env.svc.calls, ","), "Add "+v1)
		testx.AssertEqual(t, env.svc.qty, int32(2))
		testx.AssertEqual(t, env.svc.owners[0], Owner{UserID: userID})
		testx.AssertEqual(t, len(env.limiter.checks), 0, "a user's add is not a new guest cart")
	})
	t.Run("a guest's first add gets the token in the header and the body", func(t *testing.T) {
		env := newHandlerEnv()
		env.svc.token = "0190.secret"
		rec := env.serve(http.MethodPost, "/cart/items", addJSON(v1, 1), "", nil)
		b := decodeCart(t, rec)
		testx.AssertEqual(t, rec.Header().Get(HeaderToken), "0190.secret")
		if b.CartToken == nil {
			t.Fatal("no cart_token in the body")
		}
		testx.AssertEqual(t, *b.CartToken, "0190.secret")
		testx.AssertEqual(t, b.Data.ItemCount, 2)
		testx.AssertEqual(t, strings.Join(env.limiter.checks, ","), "guest-cart-ip:192.0.2.1")
	})
	t.Run("a guest with a token is not limited", func(t *testing.T) {
		env := newHandlerEnv()
		env.limiter.refuse = map[string]time.Duration{LimitGuestCartPerIP.Name: time.Minute}
		rec := env.serve(http.MethodPost, "/cart/items", addJSON(v1, 1), "", map[string]string{HeaderToken: "t"})
		testx.AssertEqual(t, rec.Code, http.StatusOK)
		testx.AssertEqual(t, len(env.limiter.checks), 0)
		testx.AssertEqual(t, env.svc.owners[0], Owner{Token: "t"})
	})
	t.Run("a guest over the limit gets 429 and no cart", func(t *testing.T) {
		env := newHandlerEnv()
		env.limiter.refuse = map[string]time.Duration{LimitGuestCartPerIP.Name: 90 * time.Second}
		rec := env.serve(http.MethodPost, "/cart/items", addJSON(v1, 1), "", nil)
		assertError(t, rec, http.StatusTooManyRequests, httpapi.CodeRateLimited)
		testx.AssertEqual(t, rec.Header().Get("Retry-After"), "90")
		testx.AssertEqual(t, len(env.svc.calls), 0)
	})
	t.Run("a limiter that fails stops the request", func(t *testing.T) {
		env := newHandlerEnv()
		env.limiter.err = errBoom
		rec := env.serve(http.MethodPost, "/cart/items", addJSON(v1, 1), "", nil)
		assertError(t, rec, http.StatusInternalServerError, httpapi.CodeInternal)
		testx.AssertEqual(t, len(env.svc.calls), 0)
	})
	t.Run("an invalid body is checked before the limit", func(t *testing.T) {
		env := newHandlerEnv()
		env.limiter.refuse = map[string]time.Duration{LimitGuestCartPerIP.Name: time.Minute}
		rec := env.serve(http.MethodPost, "/cart/items", addJSON("not-a-uuid", 0), "", nil)
		b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(b.Error.Details), 2, "details %v", b.Error.Details)
		testx.AssertTrue(t, b.Error.Details["variant_id"] != nil)
		testx.AssertTrue(t, b.Error.Details["quantity"] != nil)
		testx.AssertEqual(t, len(env.limiter.checks), 0)
		testx.AssertEqual(t, len(env.svc.calls), 0)
	})
	for _, body := range []string{"", `{"variant_id":"` + v1 + `","quantity":100}`, `{"variant_id":"` + v1 + `","quantity":1,"price":1}`} {
		t.Run("bad body "+body, func(t *testing.T) {
			env := newHandlerEnv()
			assertError(t, env.serve(http.MethodPost, "/cart/items", body, userID, nil), http.StatusBadRequest, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, len(env.svc.calls), 0)
		})
	}
}

// Every error of the service has its own answer.
func TestHandler_Errors(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		code    string
		details map[string]any
	}{
		{name: "variant unavailable", err: ErrVariantUnavailable, status: http.StatusConflict, code: CodeVariantUnavailable},
		{name: "insufficient stock", err: &InsufficientStockError{Available: 3}, status: http.StatusConflict, code: CodeInsufficientStock,
			details: map[string]any{"available": float64(3)}},
		{name: "quantity limit", err: ErrQuantityLimit, status: http.StatusConflict, code: CodeQuantityLimit,
			details: map[string]any{"max": float64(99)}},
		{name: "cart full", err: ErrCartFull, status: http.StatusConflict, code: CodeCartFull,
			details: map[string]any{"max": float64(50)}},
		{name: "cart not found", err: ErrCartNotFound, status: http.StatusNotFound, code: CodeCartNotFound},
		// The account was deleted while the token was still valid.
		{name: "account gone", err: ErrAccountGone, status: http.StatusUnauthorized, code: httpapi.CodeUnauthorized},
		{name: "line not found", err: ErrLineNotFound, status: http.StatusNotFound, code: httpapi.CodeNotFound},
		{name: "anything else", err: errBoom, status: http.StatusInternalServerError, code: httpapi.CodeInternal},
	}
	routes := []struct {
		method, path, body string
	}{
		{http.MethodGet, "/cart", ""},
		{http.MethodPost, "/cart/items", addJSON(v1, 1)},
		{http.MethodPatch, "/cart/items/" + v1, `{"quantity":2}`},
		{http.MethodDelete, "/cart/items/" + v1, ""},
		{http.MethodPost, "/cart/merge", ""},
	}
	for _, tt := range tests {
		for _, rt := range routes {
			t.Run(tt.name+" "+rt.method+" "+rt.path, func(t *testing.T) {
				env := newHandlerEnv()
				env.svc.err = tt.err
				rec := env.serve(rt.method, rt.path, rt.body, userID, map[string]string{HeaderToken: "t"})
				b := assertError(t, rec, tt.status, tt.code)
				if tt.details != nil {
					testx.AssertEqual(t, len(b.Error.Details), len(tt.details), "details %v", b.Error.Details)
					for k, v := range tt.details {
						testx.AssertEqual(t, b.Error.Details[k], v, "details[%q]", k)
					}
				}
			})
		}
	}
}

// The error is wrapped by the service; the mapping still finds it.
func TestToHTTPError_Wrapped(t *testing.T) {
	env := newHandlerEnv()
	env.svc.err = &wrapped{&InsufficientStockError{Available: 0}}
	b := assertError(t, env.serve(http.MethodGet, "/cart", "", userID, nil), http.StatusConflict, CodeInsufficientStock)
	testx.AssertEqual(t, b.Error.Details["available"], any(float64(0)))
}

type wrapped struct{ err error }

func (w *wrapped) Error() string { return "add to cart: " + w.err.Error() }
func (w *wrapped) Unwrap() error { return w.err }

func TestHandler_UpdateItem(t *testing.T) {
	env := newHandlerEnv()
	b := decodeCart(t, env.serve(http.MethodPatch, "/cart/items/"+v2, `{"quantity":5}`, userID, nil))
	testx.AssertEqual(t, b.Data.ItemCount, 2)
	testx.AssertEqual(t, strings.Join(env.svc.calls, ","), "SetQuantity "+v2)
	testx.AssertEqual(t, env.svc.qty, int32(5))

	t.Run("a path that is not a UUID is 404 without a call", func(t *testing.T) {
		env := newHandlerEnv()
		assertError(t, env.serve(http.MethodPatch, "/cart/items/nope", `{"quantity":5}`, userID, nil), http.StatusNotFound, httpapi.CodeNotFound)
		testx.AssertEqual(t, len(env.svc.calls), 0)
	})
	for _, body := range []string{`{"quantity":0}`, `{"quantity":100}`, `{}`, `nope`} {
		t.Run("bad body "+body, func(t *testing.T) {
			env := newHandlerEnv()
			assertError(t, env.serve(http.MethodPatch, "/cart/items/"+v1, body, userID, nil), http.StatusBadRequest, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, len(env.svc.calls), 0)
		})
	}
}

func TestHandler_RemoveItem(t *testing.T) {
	env := newHandlerEnv()
	env.svc.cart = Cart{}
	b := decodeCart(t, env.serve(http.MethodDelete, "/cart/items/"+v1, "", "", map[string]string{HeaderToken: "t"}))
	testx.AssertEqual(t, len(b.Data.Lines), 0)
	testx.AssertEqual(t, strings.Join(env.svc.calls, ","), "Remove "+v1)
	testx.AssertEqual(t, env.svc.owners[0], Owner{Token: "t"})

	env = newHandlerEnv()
	assertError(t, env.serve(http.MethodDelete, "/cart/items/123", "", userID, nil), http.StatusNotFound, httpapi.CodeNotFound)
	testx.AssertEqual(t, len(env.svc.calls), 0)
}

func TestHandler_Merge(t *testing.T) {
	env := newHandlerEnv()
	b := decodeCart(t, env.serve(http.MethodPost, "/cart/merge", "", userID, map[string]string{HeaderToken: "guest.tok"}))
	testx.AssertEqual(t, b.Data.ItemCount, 2)
	testx.AssertEqual(t, env.svc.merged, [2]string{userID, "guest.tok"})

	t.Run("without the header", func(t *testing.T) {
		env := newHandlerEnv()
		b := assertError(t, env.serve(http.MethodPost, "/cart/merge", "", userID, nil), http.StatusBadRequest, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, b.Error.Details[HeaderToken], any("is required: the guest cart token to merge"))
		testx.AssertEqual(t, len(env.svc.calls), 0)
	})
}

func TestLimitGuestCartPerIP(t *testing.T) {
	testx.AssertEqual(t, LimitGuestCartPerIP, auth.Limit{Name: "guest-cart-ip", Max: 30, Window: time.Hour})
	for _, l := range auth.Limits {
		testx.AssertNotEqual(t, l.Name, LimitGuestCartPerIP.Name, "its Redis key would be shared")
	}
}
