package auth

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// assertError checks the status and code of an error response and returns
// its body.
func assertError(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errorBody {
	t.Helper()
	testx.AssertEqual(t, rec.Code, status, "body %s", rec.Body.String())
	body := decodeError(t, rec)
	testx.AssertEqual(t, body.Error.Code, code, "body %s", rec.Body.String())
	return body
}

func TestHandler_Register(t *testing.T) {
	env := newHandlerEnv(0)
	var got RegisterInput
	env.svc.register = func(in RegisterInput) (user.User, error) {
		got = in
		return user.User{ID: id1, Email: "budi@example.com", Name: "Budi", Role: user.RoleBuyer,
			CreatedAt: time.Date(2026, 10, 23, 9, 0, 0, 0, time.FixedZone("WIB", 7*3600))}, nil
	}

	rec := do(env.h.Register, context.Background(),
		`{"email":"  budi@example.com ","password":" kopi susu gula aren ","name":"  Budi "}`)

	testx.AssertEqual(t, rec.Code, http.StatusCreated, "body %s", rec.Body.String())
	// Email and name are trimmed; the password is passed exactly as sent.
	testx.AssertEqual(t, got, RegisterInput{Email: "budi@example.com", Password: " kopi susu gula aren ", Name: "Budi"}) //nolint:gosec // a test value, not a credential
	var body struct {
		Data map[string]any `json:"data"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, body.Data["id"], any(id1))
	testx.AssertEqual(t, body.Data["role"], any("buyer"))
	testx.AssertEqual(t, body.Data["email_verified"], any(false))
	testx.AssertEqual(t, body.Data["created_at"], any("2026-10-23T02:00:00Z"))
	phone, present := body.Data["phone"]
	testx.AssertTrue(t, present && phone == nil, "phone is null, not missing: %s", rec.Body.String())
	_, leaked := body.Data["password_hash"]
	testx.AssertFalse(t, leaked)
	testx.AssertEqual(t, strings.Join(env.limiter.seen(), ","), "register-ip:203.0.113.7")
}

func TestHandler_RegisterValidation(t *testing.T) {
	tests := []struct {
		name string
		body string
		want map[string]string
	}{
		{name: "everything missing", body: `{}`, want: map[string]string{
			"email": "is required", "password": "is required", "name": "is required"}},
		{name: "not an email", body: `{"email":"budi","password":"kopi susu gula aren","name":"Budi"}`,
			want: map[string]string{"email": "must be an email address such as budi@example.com"}},
		{name: "non-ASCII email", body: `{"email":"büdi@example.com","password":"kopi susu gula aren","name":"Budi"}`,
			want: map[string]string{"email": "must contain only ASCII characters"}},
		{name: "email too long", body: `{"email":"` + strings.Repeat("a", 250) + `@b.co","password":"kopi susu gula aren","name":"Budi"}`,
			want: map[string]string{"email": "must be at most 254 characters"}},
		{name: "name too long", body: `{"email":"budi@example.com","password":"kopi susu gula aren","name":"` + strings.Repeat("n", 101) + `"}`,
			want: map[string]string{"name": "must be at most 100 characters"}},
		{name: "name with NUL", body: `{"email":"budi@example.com","password":"kopi susu gula aren","name":"Bu\u0000di"}`,
			want: map[string]string{"name": "must be valid UTF-8 text without NUL characters"}},
		{name: "name only spaces", body: `{"email":"budi@example.com","password":"kopi susu gula aren","name":"   "}`,
			want: map[string]string{"name": "is required"}},
		// Every field in one round trip, the password's policy included.
		{name: "policy with other fields", body: `{"email":"budi","password":"pendek","name":""}`, want: map[string]string{
			"email": "must be an email address such as budi@example.com", "name": "is required",
			"password": "must be between 8 and 128 characters"}},
		{name: "common password", body: `{"email":"budi@example.com","password":"password123","name":"Budi"}`,
			want: map[string]string{"password": "is too common; choose one that is not on a list of leaked passwords"}}, //nolint:gosec // a test value, not a credential
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			rec := do(env.h.Register, context.Background(), tt.body)
			body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
			testx.AssertEqual(t, len(body.Error.Details), len(tt.want), "details %v", body.Error.Details)
			for field, msg := range tt.want {
				testx.AssertEqual(t, body.Error.Details[field], any(msg), "details[%s]", field)
			}
			testx.AssertEqual(t, len(env.svc.called), 0, "the service is not called")
		})
	}
}

func TestHandler_RegisterBadBody(t *testing.T) {
	for _, body := range []string{``, `[]`, `{"email":"a@b.co","role":"admin"}`, `{"email":1}`} {
		env := newHandlerEnv(0)
		rec := do(env.h.Register, context.Background(), body)
		b := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
		_, hasBody := b.Error.Details["body"]
		testx.AssertTrue(t, hasBody, "body %q: details %v", body, b.Error.Details)
		testx.AssertEqual(t, len(env.svc.called), 0)
	}
}

// A field the client may not set (role, email_verified) is refused, not
// ignored: mass assignment cannot happen.
func TestHandler_RegisterRefusesRole(t *testing.T) {
	env := newHandlerEnv(0)
	rec := do(env.h.Register, context.Background(),
		`{"email":"budi@example.com","password":"kopi susu gula aren","name":"Budi","role":"admin"}`)
	body := assertError(t, rec, http.StatusBadRequest, "VALIDATION_FAILED")
	testx.AssertContains(t, body.Error.Details["body"].(string), `unknown field "role"`)
	testx.AssertEqual(t, len(env.svc.called), 0)
}

func TestHandler_RegisterServiceErrors(t *testing.T) {
	tests := []struct {
		name       string
		err        error
		wantStatus int
		wantCode   string
		wantDetail map[string]any
	}{
		{name: "email taken", err: ErrEmailTaken, wantStatus: http.StatusConflict, wantCode: CodeEmailTaken,
			wantDetail: map[string]any{"email": "is already registered; log in or reset the password"}},
		{name: "policy (checked again by the service)", err: &PasswordError{Reason: "is too common"},
			wantStatus: http.StatusBadRequest, wantCode: "VALIDATION_FAILED", wantDetail: map[string]any{"password": "is too common"}},
		{name: "invalid text from the database", err: ErrInvalidText, wantStatus: http.StatusBadRequest,
			wantCode: "VALIDATION_FAILED", wantDetail: map[string]any{"body": "must be valid UTF-8 text without NUL characters"}},
		{name: "anything else", err: errBoom, wantStatus: http.StatusInternalServerError, wantCode: "INTERNAL_ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newHandlerEnv(0)
			env.svc.register = func(RegisterInput) (user.User, error) { return user.User{}, tt.err }
			rec := do(env.h.Register, context.Background(), `{"email":"budi@example.com","password":"kopi susu gula aren","name":"Budi"}`)
			body := assertError(t, rec, tt.wantStatus, tt.wantCode)
			for k, v := range tt.wantDetail {
				testx.AssertEqual(t, body.Error.Details[k], v)
			}
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "boom"), "the cause leaks")
		})
	}
}

// Registration is limited per IP before the body is even read, so a flood
// of junk costs as much as a flood of real attempts.
func TestHandler_RegisterRateLimitedBeforeDecoding(t *testing.T) {
	env := newHandlerEnv(0)
	env.limiter.refuse = map[string]time.Duration{"register-ip": time.Minute}
	rec := do(env.h.Register, context.Background(), `not json`)
	assertError(t, rec, http.StatusTooManyRequests, "RATE_LIMITED")
	testx.AssertEqual(t, rec.Header().Get("Retry-After"), "60")
	testx.AssertEqual(t, len(env.svc.called), 0)
}

func TestHandler_Routes(t *testing.T) {
	env := newHandlerEnv(0)
	r := chi.NewRouter()
	r.Route("/v1", func(r chi.Router) {
		env.h.Routes(r)
		env.h.ProtectedRoutes(r)
	})
	paths := []string{
		"/v1/auth/register", "/v1/auth/login", "/v1/auth/refresh", "/v1/auth/logout",
		"/v1/auth/verify-email", "/v1/auth/forgot-password", "/v1/auth/reset-password",
		"/v1/auth/google", "/v1/auth/verify-email/resend",
	}
	for _, p := range paths {
		ctx := chi.NewRouteContext()
		testx.AssertTrue(t, r.Match(ctx, http.MethodPost, p), "POST %s is routed", p)
		testx.AssertFalse(t, r.Match(chi.NewRouteContext(), http.MethodGet, p), "GET %s is not", p)
	}
}

// NewHandler's clock defaults to time.Now: expires_in counts from now.
func TestHandler_DefaultClock(t *testing.T) {
	svc := &fakeAccounts{login: func(string, string) (Tokens, error) {
		return Tokens{User: testUser(), AccessExpiresAt: time.Now().Add(10 * time.Minute)}, nil
	}}
	h := NewHandler(HandlerDeps{Service: svc, Validator: newHandlerEnv(0).h.validator, Limiter: &fakeLimiter{}})
	rec := do(h.Login, context.Background(), `{"email":"budi@example.com","password":"x"}`)
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	got := decodeTokens(t, rec).Data.ExpiresIn
	testx.AssertTrue(t, got >= 599 && got <= 600, "expires_in %d", got)
}
