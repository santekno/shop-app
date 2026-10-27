// Package midtrans is GoShop's small typed client for Midtrans (ADR 0007):
// Snap transactions, built on sdk httpx. It speaks to the sandbox only; the
// configuration refuses production keys.
package midtrans

import (
	"bytes"
	"context"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/santekno/sdk/hashx"
	"github.com/santekno/sdk/httpx"
	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/payment"
)

// The sandbox endpoints: Snap creates hosted payment pages, the API
// answers a transaction's status.
const (
	SandboxSnapURL = "https://app.sandbox.midtrans.com"
	SandboxAPIURL  = "https://api.sandbox.midtrans.com"
)

// maxResponse bounds what is read of an answer: Midtrans' answers are a
// few hundred bytes, and a broken upstream must not fill memory.
const maxResponse = 1 << 20

// wib is Western Indonesia Time, the zone Snap's expiry start_time is
// written in. A fixed zone: the binary needs no time zone database.
var wib = time.FixedZone("WIB", 7*60*60)

// Client is Midtrans for one merchant (one server key).
type Client struct {
	client    *httpx.Client
	snapURL   string
	apiURL    string
	serverKey string
	clientKey string
	finishURL string
	logger    logx.Logger
}

// Option configures a Client.
type Option func(*Client)

// WithBaseURLs points the client at other Snap and API endpoints, for a
// test server.
func WithBaseURLs(snapURL, apiURL string) Option {
	return func(c *Client) {
		c.snapURL, c.apiURL = strings.TrimRight(snapURL, "/"), strings.TrimRight(apiURL, "/")
	}
}

// WithLogger makes the client log Midtrans' refusals (4xx) at WARN, with
// the status only.
func WithLogger(logger logx.Logger) Option { return func(c *Client) { c.logger = logger } }

// WithFinishURL makes every Snap transaction send the buyer to finishURL
// when they finish paying (Snap's callbacks.finish), instead of the
// "Finish Redirect URL" of the Midtrans dashboard. Empty changes nothing.
// Midtrans appends order_id, status_code and transaction_status; the page
// there must trust none of them (ADR 0007).
func WithFinishURL(finishURL string) Option { return func(c *Client) { c.finishURL = finishURL } }

// New returns a client for the merchant with serverKey (secret: it signs
// notifications and authenticates every call) and clientKey (public: for
// Snap.js). Each call gives up after timeout.
func New(serverKey, clientKey string, timeout time.Duration, opts ...Option) *Client {
	c := &Client{
		snapURL: SandboxSnapURL, apiURL: SandboxAPIURL, serverKey: serverKey, clientKey: clientKey,
		// sdk httpx: a timeout per call and a circuit breaker. No retries:
		// a buyer is waiting, and creating a transaction is not
		// idempotent. Midtrans authenticates with HTTP Basic, the server
		// key as the user name and no password.
		client: httpx.New(
			httpx.WithTimeout(timeout),
			httpx.WithRetries(0),
			httpx.WithDefaultHeader("Authorization", "Basic "+base64.StdEncoding.EncodeToString([]byte(serverKey+":"))),
		),
	}
	for _, opt := range opts {
		opt(c)
	}
	return c
}

// Name implements payment.Gateway.
func (c *Client) Name() string { return "midtrans" }

// ClientKey implements payment.Gateway.
func (c *Client) ClientKey() string { return c.clientKey }

// snapRequest is the body of POST /snap/v1/transactions. Item and
// customer details are optional at Midtrans; GoShop sends only what
// pricing needs, so the amount cannot disagree with a list of lines.
type snapRequest struct {
	TransactionDetails struct {
		OrderID     string `json:"order_id"`
		GrossAmount int64  `json:"gross_amount"`
	} `json:"transaction_details"`
	Expiry struct {
		StartTime string `json:"start_time"`
		Unit      string `json:"unit"`
		Duration  int    `json:"duration"`
	} `json:"expiry"`
	// Callbacks is left out without a finish URL, so the dashboard's
	// setting applies.
	Callbacks *snapCallbacks `json:"callbacks,omitempty"`
}

type snapCallbacks struct {
	Finish string `json:"finish"`
}

type snapResponse struct {
	Token       string `json:"token"`
	RedirectURL string `json:"redirect_url"`
}

// CreateTransaction implements payment.Gateway with Snap.
func (c *Client) CreateTransaction(ctx context.Context, req payment.TransactionRequest) (payment.Transaction, error) {
	var body snapRequest
	body.TransactionDetails.OrderID = req.OrderID
	body.TransactionDetails.GrossAmount = req.Amount
	body.Expiry.StartTime = req.Start.In(wib).Format("2006-01-02 15:04:05 -0700")
	body.Expiry.Unit = "minute"
	body.Expiry.Duration = req.Minutes
	if c.finishURL != "" {
		body.Callbacks = &snapCallbacks{Finish: c.finishURL}
	}

	var out snapResponse
	if err := c.post(ctx, c.snapURL+"/snap/v1/transactions", body, &out, http.StatusCreated); err != nil {
		return payment.Transaction{}, err
	}
	if out.Token == "" || out.RedirectURL == "" {
		return payment.Transaction{}, fmt.Errorf("%w: midtrans snap answered without a token", payment.ErrGatewayUnavailable)
	}
	return payment.Transaction{Token: out.Token, RedirectURL: out.RedirectURL}, nil
}

// statusError is an answer with an unexpected HTTP status.
type statusError struct{ status int }

func (e *statusError) Error() string { return fmt.Sprintf("midtrans answered %d", e.status) }

// post sends body as JSON and decodes a want answer into out.
func (c *Client) post(ctx context.Context, url string, body, out any, want int) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("midtrans: encode request: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(raw))
	if err != nil {
		return fmt.Errorf("midtrans: build request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	return c.do(req, want, out)
}

// do sends req and decodes a want answer into out. Every other answer is
// payment.ErrGatewayUnavailable; its body is never read into an error,
// because it may echo the request.
//
// WithoutCancel: httpx's circuit breaker counts a caller hanging up as an
// upstream failure, so a few buyers closing the app would stop payments for
// everyone (ADR 0006's Biteship lesson). The client's own timeout still
// bounds the call.
func (c *Client) do(req *http.Request, want int, out any) error {
	req.Header.Set("Accept", "application/json")
	resp, err := c.client.Do(context.WithoutCancel(req.Context()), req)
	if err != nil {
		return fmt.Errorf("%w: midtrans: %w", payment.ErrGatewayUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != want {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 && c.logger != nil {
			// A 4xx can mean GoShop's own request or key is wrong, which an
			// operator must notice. Status only: never the key or the body.
			c.logger.Warn("midtrans refused a request", "status", resp.StatusCode, "path", req.URL.Path)
		}
		return fmt.Errorf("%w: %w", payment.ErrGatewayUnavailable, &statusError{status: resp.StatusCode})
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxResponse)).Decode(out); err != nil {
		return fmt.Errorf("%w: midtrans: decode answer: %w", payment.ErrGatewayUnavailable, err)
	}
	return nil
}

// statusResponse is the answer of GET /v2/{order_id}/status.
type statusResponse struct {
	StatusCode        string `json:"status_code"`
	OrderID           string `json:"order_id"`
	TransactionID     string `json:"transaction_id"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	PaymentType       string `json:"payment_type"`
	GrossAmount       string `json:"gross_amount"`
	SignatureKey      string `json:"signature_key"`
}

// Status implements payment.Gateway with Midtrans' status API. Midtrans
// signs this answer like a notification, and Status checks that
// signature too: an answer that does not carry the merchant's signature is
// not Midtrans'.
func (c *Client) Status(ctx context.Context, orderID string) (payment.TransactionStatus, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		c.apiURL+"/v2/"+url.PathEscape(orderID)+"/status", http.NoBody)
	if err != nil {
		return payment.TransactionStatus{}, fmt.Errorf("midtrans: build request: %w", err)
	}
	var out statusResponse
	// An unknown order_id is answered 404, in the HTTP status or only in
	// the body's status_code depending on the endpoint's version: both
	// mean "no such transaction".
	if err := c.do(req, http.StatusOK, &out); err != nil {
		var se *statusError
		if errors.As(err, &se) && se.status == http.StatusNotFound {
			return payment.TransactionStatus{}, payment.ErrTransactionNotFound
		}
		return payment.TransactionStatus{}, err
	}
	if out.StatusCode == "404" {
		return payment.TransactionStatus{}, payment.ErrTransactionNotFound
	}
	if out.OrderID != orderID || !c.VerifySignature(out.OrderID, out.StatusCode, out.GrossAmount, out.SignatureKey) {
		return payment.TransactionStatus{}, fmt.Errorf("%w: midtrans status answer is not signed for %s",
			payment.ErrGatewayUnavailable, orderID)
	}
	return payment.TransactionStatus{
		OrderID: out.OrderID, StatusCode: out.StatusCode, TransactionID: out.TransactionID,
		TransactionStatus: out.TransactionStatus, FraudStatus: out.FraudStatus,
		PaymentType: out.PaymentType, GrossAmount: out.GrossAmount,
	}, nil
}

// VerifySignature implements payment.Gateway: Midtrans' signature_key is
// the hex SHA-512 of order_id, status_code, gross_amount and the server
// key, in that order. Only a holder of the server key can make it.
func (c *Client) VerifySignature(orderID, statusCode, grossAmount, signature string) bool {
	return CheckSignature(c.serverKey, orderID, statusCode, grossAmount, signature)
}

// Signature is Midtrans' signature_key of a notification or status
// answer, signed with serverKey.
func Signature(serverKey, orderID, statusCode, grossAmount string) string {
	sum := sha512.Sum512([]byte(orderID + statusCode + grossAmount + serverKey))
	return hex.EncodeToString(sum[:])
}

// CheckSignature reports whether signature is Signature of the fields,
// compared in constant time (sdk hashx), so the time it takes says nothing
// about how many characters were right. Case does not matter.
func CheckSignature(serverKey, orderID, statusCode, grossAmount, signature string) bool {
	want := Signature(serverKey, orderID, statusCode, grossAmount)
	return hashx.ConstantTimeEqual([]byte(want), []byte(strings.ToLower(signature)))
}
