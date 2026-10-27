package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/errx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The 4xx codes this feature adds (see api/openapi.yaml).
const (
	CodeEmailTaken         = "EMAIL_TAKEN"
	CodeInvalidCredentials = "INVALID_CREDENTIALS" //nolint:gosec // an error code, not a credential
	CodeTokenInvalid       = "TOKEN_INVALID"
	CodeTokenExpired       = "TOKEN_EXPIRED"
	CodeEmailUnverified    = "EMAIL_UNVERIFIED"
)

// Accounts is what the handlers need from the service.
type Accounts interface {
	Register(ctx context.Context, in RegisterInput) (user.User, error)
	Login(ctx context.Context, email, password string) (Tokens, error)
	Refresh(ctx context.Context, refreshToken string) (Tokens, error)
	Logout(ctx context.Context, refreshToken string) error
	VerifyEmail(ctx context.Context, token string) error
	ResendVerification(ctx context.Context, userID string) error
	ForgotPassword(ctx context.Context, email string) error
	ResetPassword(ctx context.Context, token, newPassword string) error
	GoogleLogin(ctx context.Context, idToken string) (Tokens, error)
}

// Handler serves the /v1/auth endpoints.
type Handler struct {
	svc         Accounts
	validator   *httpapi.Validator
	limiter     RateLimiter
	now         func() time.Time
	trustedHops int
	// web is the browser session's cookie and origin settings (web.go).
	web WebSession
}

// HandlerDeps is what the handler needs. Service, Validator and Limiter
// are required.
type HandlerDeps struct {
	Service   Accounts
	Validator *httpapi.Validator
	Limiter   RateLimiter
	// Clock is the clock for "expires_in"; time.Now when nil.
	Clock func() time.Time
	// TrustedProxyHops is APP_TRUSTED_PROXY_HOPS, for httpapi.ClientIP.
	TrustedProxyHops int
	// WebSession configures the /v1/auth/web endpoints (Bab 10).
	WebSession WebSession
}

// NewHandler returns a Handler built from deps.
func NewHandler(deps HandlerDeps) *Handler {
	h := &Handler{
		svc: deps.Service, validator: deps.Validator, limiter: deps.Limiter,
		now: deps.Clock, trustedHops: deps.TrustedProxyHops, web: deps.WebSession,
	}
	if h.now == nil {
		h.now = time.Now
	}
	return h
}

// Routes registers the auth routes on r (mounted under /v1).
func (h *Handler) Routes(r chi.Router) {
	r.Post("/auth/register", h.Register)
	r.Post("/auth/login", h.Login)
	r.Post("/auth/refresh", h.Refresh)
	r.Post("/auth/logout", h.Logout)
	r.Post("/auth/verify-email", h.VerifyEmail)
	r.Post("/auth/forgot-password", h.ForgotPassword)
	r.Post("/auth/reset-password", h.ResetPassword)
	r.Post("/auth/google", h.GoogleLogin)
	// The browser's session (Bab 10, web.go): the same accounts, with the
	// refresh token in an httpOnly cookie instead of the body.
	web := r.With(h.requireWebClient)
	web.Post("/auth/web/login", h.WebLogin)
	web.Post("/auth/web/refresh", h.WebRefresh)
	web.Post("/auth/web/logout", h.WebLogout)
}

// ProtectedRoutes registers the auth routes that need a logged-in user, on
// r (mounted under /v1 behind Guard.Authenticate).
func (h *Handler) ProtectedRoutes(r chi.Router) {
	r.Post("/auth/verify-email/resend", h.ResendVerification)
}

// registerBody is the request body of POST /v1/auth/register. The
// password has no length rule here: CheckPassword owns the policy.
type registerBody struct {
	Email    string `json:"email" validate:"required,max=254,email"`
	Password string `json:"password" validate:"required"`
	Name     string `json:"name" validate:"required,max=100"`
}

// Register serves POST /v1/auth/register: 201 with the new account.
func (h *Handler) Register(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, limitCheck{LimitRegisterPerIP, h.clientIP(r)}) {
		return
	}
	var body registerBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	body.Email, body.Name = strings.TrimSpace(body.Email), strings.TrimSpace(body.Name)
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkEmail(details, body.Email)
	checkText(details, "name", body.Name)
	checkPassword(details, "password", body.Password)
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}

	u, err := h.svc.Register(r.Context(), RegisterInput{Email: body.Email, Password: body.Password, Name: body.Name})
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: user.ToJSON(u)})
}

// loginBody is the request body of POST /v1/auth/login. Only presence and
// a sane length are checked: a malformed email simply matches no account.
type loginBody struct {
	Email    string `json:"email" validate:"required,max=254"`
	Password string `json:"password" validate:"required,max=1024"`
}

// Login serves POST /v1/auth/login: 200 with an access token, or 401
// INVALID_CREDENTIALS whatever was wrong.
func (h *Handler) Login(w http.ResponseWriter, r *http.Request) {
	tokens, ok := h.login(w, r)
	if !ok {
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toTokensJSON(tokens, h.now())})
}

// login is the body of Login and WebLogin: decode, count, validate, log
// in. When ok is false it has answered already.
func (h *Handler) login(w http.ResponseWriter, r *http.Request) (Tokens, bool) {
	var body loginBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return Tokens{}, false
	}
	// Counted before validation, so a malformed attempt costs one too.
	if !h.allow(w, r, limitCheck{LimitLoginPerIP, h.clientIP(r)}, limitCheck{LimitLoginPerEmail, EmailKey(body.Email)}) {
		return Tokens{}, false
	}
	if err := h.validator.Struct(body); err != nil {
		httpapi.Error(w, r, err)
		return Tokens{}, false
	}
	tokens, err := h.svc.Login(r.Context(), body.Email, body.Password)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return Tokens{}, false
	}
	return tokens, true
}

// refreshBody is the request body of POST /v1/auth/refresh and
// /v1/auth/logout, the mobile app's transport (ADR 0005). A browser uses
// the /v1/auth/web endpoints and the goshop_refresh cookie instead.
type refreshBody struct {
	RefreshToken string `json:"refresh_token" validate:"required,max=200"`
}

// Refresh serves POST /v1/auth/refresh: 200 with new tokens; the presented
// refresh token stops working.
func (h *Handler) Refresh(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, limitCheck{LimitRefreshPerIP, h.clientIP(r)}) {
		return
	}
	var body refreshBody
	if err := h.decodeValid(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	tokens, err := h.svc.Refresh(r.Context(), body.RefreshToken)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toTokensJSON(tokens, h.now())})
}

// Logout serves POST /v1/auth/logout: 204, whether or not the token was
// still valid.
func (h *Handler) Logout(w http.ResponseWriter, r *http.Request) {
	var body refreshBody
	if err := h.decodeValid(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.svc.Logout(r.Context(), body.RefreshToken); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// tokenBody is the request body of the endpoints that use a token sent by
// email.
type tokenBody struct {
	Token string `json:"token" validate:"required,max=200"`
}

// VerifyEmail serves POST /v1/auth/verify-email: 204, and the account's
// email is verified.
func (h *Handler) VerifyEmail(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, limitCheck{LimitVerifyEmailPerIP, h.clientIP(r)}) {
		return
	}
	var body tokenBody
	if err := h.decodeValid(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.svc.VerifyEmail(r.Context(), body.Token); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ResendVerification serves POST /v1/auth/verify-email/resend: 202, and a
// new token is on its way unless the email is verified already.
func (h *Handler) ResendVerification(w http.ResponseWriter, r *http.Request) {
	claims, _ := ClaimsFrom(r.Context()) // the route is behind Guard.Authenticate
	if !h.allow(w, r, limitCheck{LimitResendPerUser, claims.UserID}) {
		return
	}
	if err := h.svc.ResendVerification(r.Context(), claims.UserID); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// forgotBody is the request body of POST /v1/auth/forgot-password.
type forgotBody struct {
	Email string `json:"email" validate:"required,max=254"`
}

// ForgotPassword serves POST /v1/auth/forgot-password: always 202, so the
// answer does not say whether the email has an account.
func (h *Handler) ForgotPassword(w http.ResponseWriter, r *http.Request) {
	var body forgotBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if !h.allow(w, r, limitCheck{LimitForgotPerIP, h.clientIP(r)}, limitCheck{LimitForgotPerEmail, EmailKey(body.Email)}) {
		return
	}
	if err := h.validator.Struct(body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.svc.ForgotPassword(r.Context(), body.Email); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusAccepted)
}

// resetBody is the request body of POST /v1/auth/reset-password.
type resetBody struct {
	Token    string `json:"token" validate:"required,max=200"`
	Password string `json:"password" validate:"required"`
}

// ResetPassword serves POST /v1/auth/reset-password: 204, the new password
// works and every session of the account is over.
func (h *Handler) ResetPassword(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, limitCheck{LimitResetPerIP, h.clientIP(r)}) {
		return
	}
	var body resetBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	details, err := h.validator.StructFields(body, "")
	if err != nil {
		httpapi.Error(w, r, err)
		return
	}
	checkPassword(details, "password", body.Password)
	if len(details) > 0 {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", details))
		return
	}
	if err := h.svc.ResetPassword(r.Context(), body.Token, body.Password); err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// googleBody is the request body of POST /v1/auth/google. Google ID tokens
// are a few kilobytes at most.
type googleBody struct {
	IDToken string `json:"id_token" validate:"required,max=8192"`
}

// GoogleLogin serves POST /v1/auth/google: 200 with the tokens of a new
// session, creating the account on the first sign-in.
func (h *Handler) GoogleLogin(w http.ResponseWriter, r *http.Request) {
	if !h.allow(w, r, limitCheck{LimitGooglePerIP, h.clientIP(r)}) {
		return
	}
	var body googleBody
	if err := h.decodeValid(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	tokens, err := h.svc.GoogleLogin(r.Context(), body.IDToken)
	if err != nil {
		httpapi.Error(w, r, toHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: toTokensJSON(tokens, h.now())})
}

// limitCheck is one rate limit to apply, with the key to count under.
type limitCheck struct {
	limit Limit
	key   string
}

// allow counts the request under every check, in order, and reports
// whether it may go on. Otherwise it has answered 429 RATE_LIMITED with
// Retry-After (whole seconds, rounded up), or 500 when Redis failed: a
// limit that cannot be checked is not skipped.
func (h *Handler) allow(w http.ResponseWriter, r *http.Request, checks ...limitCheck) bool {
	for _, c := range checks {
		if !Allow(w, r, h.limiter, c.limit, c.key) {
			return false
		}
	}
	return true
}

// Allow counts one request of r under limit for key and reports whether it
// may go on. Otherwise it has answered 429 RATE_LIMITED with Retry-After
// (whole seconds, rounded up), or 500 when Redis failed: a limit that
// cannot be checked is not skipped. Other features (the guest cart,
// checkout) use it for their own limits.
func Allow(w http.ResponseWriter, r *http.Request, limiter RateLimiter, limit Limit, key string) bool {
	ok, retryAfter, err := limiter.Allow(r.Context(), limit, key)
	if err != nil {
		httpapi.Error(w, r, err)
		return false
	}
	if !ok {
		seconds := max(1, int((retryAfter+time.Second-1)/time.Second))
		w.Header().Set("Retry-After", strconv.Itoa(seconds))
		httpapi.Error(w, r, httpapi.RateLimitedError(seconds))
		return false
	}
	return true
}

// clientIP is the caller's key for the per-IP limits: its address, or its
// /64 for IPv6 (httpapi.RateLimitKey).
func (h *Handler) clientIP(r *http.Request) string {
	return httpapi.RateLimitKey(httpapi.ClientIP(r, h.trustedHops))
}

// decodeValid decodes the JSON body into dst and validates it.
func (h *Handler) decodeValid(w http.ResponseWriter, r *http.Request, dst any) error {
	if err := httpapi.DecodeJSON(w, r, dst); err != nil {
		return err
	}
	return h.validator.Struct(dst)
}

// checkEmail adds a message to details when email, already checked for
// shape by the validator, is not plain ASCII.
func checkEmail(details map[string]any, email string) {
	if _, failed := details["email"]; !failed && !isASCII(email) {
		details["email"] = "must contain only ASCII characters"
	}
}

// checkPassword adds the policy's reason to details, so a sign-up form
// learns about every field in one round trip. The service checks again.
func checkPassword(details map[string]any, field, password string) {
	var pwErr *PasswordError
	if _, failed := details[field]; !failed && errors.As(CheckPassword(password), &pwErr) {
		details[field] = pwErr.Reason
	}
}

// checkText adds a message to details when value cannot be stored as text.
func checkText(details map[string]any, field, value string) {
	if _, failed := details[field]; !failed && !httpapi.ValidText(value) {
		details[field] = httpapi.InvalidTextMessage
	}
}

// toHTTPError maps the service's errors to the API's error responses.
// Anything it does not know stays as it is and becomes a 500.
func toHTTPError(err error) error {
	var pwErr *PasswordError
	switch {
	case errors.As(err, &pwErr):
		return httpapi.ValidationError("invalid request", map[string]any{"password": pwErr.Reason})
	case errors.Is(err, ErrGoogleTokenInvalid):
		return errx.New(CodeTokenInvalid, "the Google sign-in could not be verified; try again").
			WithHTTPStatus(http.StatusUnauthorized)
	case errors.Is(err, ErrGoogleEmailUnverified):
		return errx.New(CodeEmailUnverified, "verify the email of your Google account first").
			WithHTTPStatus(http.StatusBadRequest)
	case errors.Is(err, ErrGoogleDisabled):
		return httpapi.NotFoundError("route not found")
	case errors.Is(err, ErrEmailTaken):
		return errx.New(CodeEmailTaken, "an account with this email already exists").
			WithHTTPStatus(http.StatusConflict).
			WithDetails(map[string]any{"email": "is already registered; log in or reset the password"})
	case errors.Is(err, ErrInvalidCredentials):
		return errx.New(CodeInvalidCredentials, "email or password is incorrect").
			WithHTTPStatus(http.StatusUnauthorized)
	case errors.Is(err, ErrRefreshTokenInvalid):
		return errx.New(CodeTokenInvalid, "the token is invalid or has been revoked; log in again").
			WithHTTPStatus(http.StatusUnauthorized)
	case errors.Is(err, ErrRefreshTokenExpired):
		return errx.New(CodeTokenExpired, "the token has expired; log in again").
			WithHTTPStatus(http.StatusUnauthorized)
	case errors.Is(err, ErrEmailTokenInvalid):
		return errx.New(CodeTokenInvalid, "the token is invalid or has already been used").
			WithHTTPStatus(http.StatusBadRequest)
	case errors.Is(err, ErrEmailTokenExpired):
		return errx.New(CodeTokenExpired, "the token has expired; ask for a new email").
			WithHTTPStatus(http.StatusBadRequest)
	case errors.Is(err, ErrNoUser):
		return httpapi.UnauthorizedError("this account no longer exists")
	case errors.Is(err, ErrInvalidText):
		return httpapi.ValidationError("invalid request", map[string]any{"body": httpapi.InvalidTextMessage})
	default:
		return err
	}
}

type dataResponse struct {
	Data any `json:"data"`
}

// tokensJSON is TokenPair in api/openapi.yaml.
type tokensJSON struct {
	AccessToken      string    `json:"access_token"`
	TokenType        string    `json:"token_type"`
	ExpiresIn        int64     `json:"expires_in"`
	RefreshToken     string    `json:"refresh_token"`
	RefreshExpiresIn int64     `json:"refresh_expires_in"`
	User             user.JSON `json:"user"`
}

func toTokensJSON(t Tokens, now time.Time) tokensJSON {
	return tokensJSON{
		AccessToken:      t.AccessToken,
		TokenType:        "Bearer",
		ExpiresIn:        secondsUntil(t.AccessExpiresAt, now),
		RefreshToken:     t.RefreshToken,
		RefreshExpiresIn: secondsUntil(t.RefreshExpiresAt, now),
		User:             user.ToJSON(t.User),
	}
}

// secondsUntil is how many whole seconds remain until t, never negative.
func secondsUntil(t, now time.Time) int64 {
	return max(0, int64(t.Sub(now)/time.Second))
}
