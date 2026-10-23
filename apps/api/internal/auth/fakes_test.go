package auth

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The fakes of this package's tests. They live in package auth (not
// auth_test) because Repository's methods take the unexported opaqueToken.

// errBoom is the "something else broke" error of these tests.
var errBoom = errors.New("boom")

// testSecret is a JWT_SECRET for tests: 32 bytes, not a real key.
var testSecret = []byte("test-only-jwt-key-0123456789abcd")

// fixedNow is the clock of the service tests. It is near the real time,
// because jwtx checks "exp" against the wall clock too.
func fixedNow() time.Time { return time.Now().Truncate(time.Second) }

// fakeRepo is a Repository whose every method is a field; a nil field
// fails the test if it is called, so each test states what it expects.
type fakeRepo struct {
	t *testing.T

	createUser             func(NewUser) (user.User, error)
	getCredentials         func(email string) (Credentials, error)
	createRefreshToken     func(NewRefreshToken) error
	rotateRefreshToken     func(presented, next opaqueToken, now, nextExpiresAt time.Time) (Rotated, error)
	revokeSessionOf        func(presented opaqueToken) (string, error)
	getUser                func(id string) (user.User, error)
	createEmailToken       func(NewEmailToken) error
	verifyEmail            func(presented opaqueToken, now time.Time) error
	resetPassword          func(presented opaqueToken, now time.Time, newHash string) ([]string, error)
	getUserByIdentity      func(provider, subject string) (user.User, error)
	createUserWithIdentity func(u NewUser, identityID, provider, subject string) (user.User, error)
}

func (r *fakeRepo) unexpected(name string) {
	r.t.Helper()
	r.t.Fatalf("unexpected call to Repository.%s", name)
}

func (r *fakeRepo) CreateUser(_ context.Context, u NewUser) (user.User, error) {
	if r.createUser == nil {
		r.unexpected("CreateUser")
	}
	return r.createUser(u)
}

func (r *fakeRepo) GetCredentials(_ context.Context, email string) (Credentials, error) {
	if r.getCredentials == nil {
		r.unexpected("GetCredentials")
	}
	return r.getCredentials(email)
}

func (r *fakeRepo) CreateRefreshToken(_ context.Context, t NewRefreshToken) error {
	if r.createRefreshToken == nil {
		r.unexpected("CreateRefreshToken")
	}
	return r.createRefreshToken(t)
}

func (r *fakeRepo) RotateRefreshToken(_ context.Context, presented, next opaqueToken, now, nextExpiresAt time.Time) (Rotated, error) {
	if r.rotateRefreshToken == nil {
		r.unexpected("RotateRefreshToken")
	}
	return r.rotateRefreshToken(presented, next, now, nextExpiresAt)
}

func (r *fakeRepo) RevokeSessionOf(_ context.Context, presented opaqueToken) (string, error) {
	if r.revokeSessionOf == nil {
		r.unexpected("RevokeSessionOf")
	}
	return r.revokeSessionOf(presented)
}

func (r *fakeRepo) GetUser(_ context.Context, id string) (user.User, error) {
	if r.getUser == nil {
		r.unexpected("GetUser")
	}
	return r.getUser(id)
}

func (r *fakeRepo) CreateEmailToken(_ context.Context, t NewEmailToken) error {
	if r.createEmailToken == nil {
		r.unexpected("CreateEmailToken")
	}
	return r.createEmailToken(t)
}

func (r *fakeRepo) VerifyEmail(_ context.Context, presented opaqueToken, now time.Time) error {
	if r.verifyEmail == nil {
		r.unexpected("VerifyEmail")
	}
	return r.verifyEmail(presented, now)
}

func (r *fakeRepo) ResetPassword(_ context.Context, presented opaqueToken, now time.Time, newHash string) ([]string, error) {
	if r.resetPassword == nil {
		r.unexpected("ResetPassword")
	}
	return r.resetPassword(presented, now, newHash)
}

func (r *fakeRepo) GetUserByIdentity(_ context.Context, provider, subject string) (user.User, error) {
	if r.getUserByIdentity == nil {
		r.unexpected("GetUserByIdentity")
	}
	return r.getUserByIdentity(provider, subject)
}

func (r *fakeRepo) CreateUserWithIdentity(_ context.Context, u NewUser, identityID, provider, subject string) (user.User, error) {
	if r.createUserWithIdentity == nil {
		r.unexpected("CreateUserWithIdentity")
	}
	return r.createUserWithIdentity(u, identityID, provider, subject)
}

// fakeHasher "hashes" by prefixing, so a test can see what was hashed.
// Verify records the hash it was given, to prove the dummy path ran.
type fakeHasher struct {
	mu        sync.Mutex
	hashErr   error
	verifyErr error
	hashed    []string
	verified  []string // the hashes Verify was asked about
}

func (h *fakeHasher) Hash(_ context.Context, password string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.hashErr != nil {
		return "", h.hashErr
	}
	h.hashed = append(h.hashed, password)
	return "hash:" + password, nil
}

func (h *fakeHasher) Verify(_ context.Context, password, hash string) (bool, error) {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.verified = append(h.verified, hash)
	if h.verifyErr != nil {
		return false, h.verifyErr
	}
	return hash != "" && hash == "hash:"+password, nil
}

// fakeMailer records every message, or fails with err.
type fakeMailer struct {
	mu   sync.Mutex
	err  error
	sent []mail.Message
}

func (m *fakeMailer) Send(_ context.Context, msg mail.Message) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return m.err
	}
	m.sent = append(m.sent, msg)
	return nil
}

func (m *fakeMailer) messages() []mail.Message {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]mail.Message(nil), m.sent...)
}

// fakeRevocations is an in-memory SessionRevocations.
type fakeRevocations struct {
	mu        sync.Mutex
	revoked   map[string]bool
	calls     [][]string
	revokeErr error
	checkErr  error
}

func newFakeRevocations() *fakeRevocations { return &fakeRevocations{revoked: map[string]bool{}} }

func (f *fakeRevocations) Revoke(_ context.Context, sessionIDs ...string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, append([]string(nil), sessionIDs...))
	if f.revokeErr != nil {
		return f.revokeErr
	}
	for _, id := range sessionIDs {
		f.revoked[id] = true
	}
	return nil
}

func (f *fakeRevocations) IsRevoked(_ context.Context, sessionID string) (bool, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.checkErr != nil {
		return false, f.checkErr
	}
	return f.revoked[sessionID], nil
}

func (f *fakeRevocations) revokeCalls() [][]string {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([][]string(nil), f.calls...)
}

// fakeGoogle returns a fixed identity, or err.
type fakeGoogle struct {
	id    GoogleIdentity
	err   error
	calls []string
}

func (g *fakeGoogle) Verify(_ context.Context, raw string) (GoogleIdentity, error) {
	g.calls = append(g.calls, raw)
	return g.id, g.err
}

// fakeLimiter allows everything except the limits named in refuse, and
// records each check in order.
type fakeLimiter struct {
	mu         sync.Mutex
	refuse     map[string]time.Duration // limit name → retry after
	err        error
	checks     []string // "<limit>:<key>"
	errOnLimit string   // when set, only this limit fails with err
}

func (l *fakeLimiter) Allow(_ context.Context, limit Limit, key string) (bool, time.Duration, error) {
	l.mu.Lock()
	defer l.mu.Unlock()
	l.checks = append(l.checks, limit.Name+":"+key)
	if l.err != nil && (l.errOnLimit == "" || l.errOnLimit == limit.Name) {
		return false, 0, l.err
	}
	if retry, ok := l.refuse[limit.Name]; ok {
		return false, retry, nil
	}
	return true, 0, nil
}

func (l *fakeLimiter) seen() []string {
	l.mu.Lock()
	defer l.mu.Unlock()
	return append([]string(nil), l.checks...)
}

// fixedIDs returns a NewID that hands out ids in order, then fails the test.
func fixedIDs(t *testing.T, ids ...string) func() string {
	t.Helper()
	var mu sync.Mutex
	return func() string {
		mu.Lock()
		defer mu.Unlock()
		if len(ids) == 0 {
			t.Fatal("NewID called more often than the test expected")
			return ""
		}
		id := ids[0]
		ids = ids[1:]
		return id
	}
}

// Ids in the UUID shape the opaque tokens need.
const (
	id1 = "0190c8a0-0000-7000-8000-000000000001"
	id2 = "0190c8a0-0000-7000-8000-000000000002"
	id3 = "0190c8a0-0000-7000-8000-000000000003"
	id4 = "0190c8a0-0000-7000-8000-000000000004"
	id5 = "0190c8a0-0000-7000-8000-000000000005"
)

// zeroReader is a Random that always reads zeros, so secrets are known.
type zeroReader struct{}

func (zeroReader) Read(p []byte) (int, error) {
	clear(p)
	return len(p), nil
}

// failingReader is a Random that cannot be read.
type failingReader struct{}

func (failingReader) Read([]byte) (int, error) { return 0, io.ErrUnexpectedEOF }

// serviceEnv is a Service on fakes, with the log of its context.
type serviceEnv struct {
	svc     *Service
	repo    *fakeRepo
	hasher  *fakeHasher
	mailer  *fakeMailer
	revoked *fakeRevocations
	access  *AccessTokens
	logs    *bytes.Buffer
	ctx     context.Context
	now     time.Time
}

// newServiceEnv builds a Service; change adjusts the Deps before NewService.
func newServiceEnv(t *testing.T, change func(*Deps)) *serviceEnv {
	t.Helper()
	now := fixedNow()
	env := &serviceEnv{
		repo:    &fakeRepo{t: t},
		hasher:  &fakeHasher{},
		mailer:  &fakeMailer{},
		revoked: newFakeRevocations(),
		access:  NewAccessTokens(testSecret, 15*time.Minute, func() time.Time { return now }),
		now:     now,
	}
	env.ctx, env.logs = ctxWithLogs()
	deps := Deps{
		Repo: env.repo, Hasher: env.hasher, Access: env.access, RefreshTTL: 30 * 24 * time.Hour,
		Mailer: env.mailer, Revocations: env.revoked,
		Clock: func() time.Time { return now }, Random: zeroReader{},
	}
	if change != nil {
		change(&deps)
	}
	env.svc = NewService(deps)
	return env
}

// ctxWithLogs is a context whose logger writes JSON lines to the buffer.
func ctxWithLogs() (context.Context, *bytes.Buffer) {
	var buf bytes.Buffer
	logger := logx.New(logx.WithOutput(&buf), logx.WithFormat("json"), logx.WithLevel("debug"))
	return logx.WithContextLogger(context.Background(), logger), &buf
}

// logLines decodes each JSON log line in buf.
func logLines(t *testing.T, buf *bytes.Buffer) []map[string]any {
	t.Helper()
	var lines []map[string]any
	for line := range strings.SplitSeq(strings.TrimSpace(buf.String()), "\n") {
		if line == "" {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal([]byte(line), &m); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		lines = append(lines, m)
	}
	return lines
}

// findLog returns the first log line whose msg is msg.
func findLog(t *testing.T, buf *bytes.Buffer, msg string) (map[string]any, bool) {
	t.Helper()
	for _, l := range logLines(t, buf) {
		if l["msg"] == msg {
			return l, true
		}
	}
	return nil, false
}

// testUser is a buyer as the repository returns it.
func testUser() user.User {
	return user.User{
		ID: id1, Email: "budi@example.com", Name: "Budi", Role: user.RoleBuyer,
		CreatedAt: time.Date(2026, 10, 1, 9, 0, 0, 0, time.UTC),
	}
}

// fakeAccounts is an Accounts whose methods are fields; a nil field
// answers with errBoom so a test notices a call it did not expect.
type fakeAccounts struct {
	register           func(RegisterInput) (user.User, error)
	login              func(email, password string) (Tokens, error)
	refresh            func(token string) (Tokens, error)
	logout             func(token string) error
	verifyEmail        func(token string) error
	resendVerification func(userID string) error
	forgotPassword     func(email string) error
	resetPassword      func(token, password string) error
	googleLogin        func(idToken string) (Tokens, error)
	called             []string
}

func (a *fakeAccounts) Register(_ context.Context, in RegisterInput) (user.User, error) {
	a.called = append(a.called, "Register")
	if a.register == nil {
		return user.User{}, errBoom
	}
	return a.register(in)
}

func (a *fakeAccounts) Login(_ context.Context, email, password string) (Tokens, error) {
	a.called = append(a.called, "Login")
	if a.login == nil {
		return Tokens{}, errBoom
	}
	return a.login(email, password)
}

func (a *fakeAccounts) Refresh(_ context.Context, token string) (Tokens, error) {
	a.called = append(a.called, "Refresh")
	if a.refresh == nil {
		return Tokens{}, errBoom
	}
	return a.refresh(token)
}

func (a *fakeAccounts) Logout(_ context.Context, token string) error {
	a.called = append(a.called, "Logout")
	if a.logout == nil {
		return errBoom
	}
	return a.logout(token)
}

func (a *fakeAccounts) VerifyEmail(_ context.Context, token string) error {
	a.called = append(a.called, "VerifyEmail")
	if a.verifyEmail == nil {
		return errBoom
	}
	return a.verifyEmail(token)
}

func (a *fakeAccounts) ResendVerification(_ context.Context, userID string) error {
	a.called = append(a.called, "ResendVerification")
	if a.resendVerification == nil {
		return errBoom
	}
	return a.resendVerification(userID)
}

func (a *fakeAccounts) ForgotPassword(_ context.Context, email string) error {
	a.called = append(a.called, "ForgotPassword")
	if a.forgotPassword == nil {
		return errBoom
	}
	return a.forgotPassword(email)
}

func (a *fakeAccounts) ResetPassword(_ context.Context, token, password string) error {
	a.called = append(a.called, "ResetPassword")
	if a.resetPassword == nil {
		return errBoom
	}
	return a.resetPassword(token, password)
}

func (a *fakeAccounts) GoogleLogin(_ context.Context, idToken string) (Tokens, error) {
	a.called = append(a.called, "GoogleLogin")
	if a.googleLogin == nil {
		return Tokens{}, errBoom
	}
	return a.googleLogin(idToken)
}

// handlerEnv is a Handler on fakes.
type handlerEnv struct {
	h       *Handler
	svc     *fakeAccounts
	limiter *fakeLimiter
	now     time.Time
}

func newHandlerEnv(hops int) *handlerEnv {
	now := time.Date(2026, 10, 23, 10, 0, 0, 0, time.UTC)
	env := &handlerEnv{svc: &fakeAccounts{}, limiter: &fakeLimiter{}, now: now}
	env.h = NewHandler(HandlerDeps{
		Service: env.svc, Validator: httpapi.NewValidator(), Limiter: env.limiter,
		Clock: func() time.Time { return now }, TrustedProxyHops: hops,
	})
	return env
}

// do sends a request with body to handler fn and returns the recorder.
// The client address is 203.0.113.7.
func do(fn http.HandlerFunc, ctx context.Context, body string) *httptest.ResponseRecorder {
	r := httptest.NewRequestWithContext(ctx, http.MethodPost, "/v1/auth/x", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/json")
	r.RemoteAddr = "203.0.113.7:4321"
	rec := httptest.NewRecorder()
	fn(rec, r)
	return rec
}

// errorBody is the API's error shape.
type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
		Details map[string]any `json:"details"`
	} `json:"error"`
}

func decodeError(t *testing.T, rec *httptest.ResponseRecorder) errorBody {
	t.Helper()
	var body errorBody
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error body %q: %v", rec.Body.String(), err)
	}
	return body
}

// tokensResponse is the TokenPair response.
type tokensResponse struct {
	Data struct {
		AccessToken      string         `json:"access_token"`
		TokenType        string         `json:"token_type"`
		ExpiresIn        int64          `json:"expires_in"`
		RefreshToken     string         `json:"refresh_token"`
		RefreshExpiresIn int64          `json:"refresh_expires_in"`
		User             map[string]any `json:"user"`
	} `json:"data"`
}

func decodeTokens(t *testing.T, rec *httptest.ResponseRecorder) tokensResponse {
	t.Helper()
	var body tokensResponse
	dec := json.NewDecoder(bytes.NewReader(rec.Body.Bytes()))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		t.Fatalf("decode tokens %q: %v", rec.Body.String(), err)
	}
	return body
}
