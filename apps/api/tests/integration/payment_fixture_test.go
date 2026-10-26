//go:build integration

package integration_test

import (
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/payment/midtrans"
	"github.com/santekno/shop-app/apps/api/internal/user"
)

// The Bab 6 payment harness: a shop whose payments go to the fake gateway
// (internal/payment/fake, transactions in memory), so a test plays
// Midtrans: gw.Pay sets a transaction's status and returns the signed
// notification Midtrans would send, and notify posts it to the real
// webhook over HTTP. Midtrans' own client (internal/payment/midtrans) is
// covered against fakeMidtrans, an httptest server speaking Snap and the
// status API, at the HTTP boundary.

// payShop is a shop with the fake payment gateway.
type payShop struct {
	*shop
	gw *fake.Gateway
}

// newPayShop starts a shop whose payments go to a fake gateway of its own.
func newPayShop(t *testing.T, env map[string]string, opts ...app.Option) *payShop {
	t.Helper()
	gw := fake.New(fake.NewMemoryStore())
	return &payShop{shop: newShop(t, env, append([]app.Option{app.WithPaymentGateway(gw)}, opts...)...), gw: gw}
}

// paymentOut is PaymentSession.
type paymentOut struct {
	ID          string    `json:"id"`
	OrderID     string    `json:"order_id"`
	Provider    string    `json:"provider"`
	Status      string    `json:"status"`
	Amount      moneyOut  `json:"amount"`
	Token       string    `json:"token"`
	RedirectURL string    `json:"redirect_url"`
	ClientKey   string    `json:"client_key"`
	ExpiresAt   time.Time `json:"expires_at"`
	CreatedAt   time.Time `json:"created_at"`
}

// tryPay is POST /v1/orders/{id}/pay for goroutines.
func (sh *shop) tryPay(token, orderID string) (response, error) {
	return sh.tryCall(http.MethodPost, "/v1/orders/"+orderID+"/pay", nil, token, nil)
}

// pay is POST /v1/orders/{id}/pay as token.
func (sh *shop) pay(t *testing.T, token, orderID string) response {
	t.Helper()
	resp, err := sh.tryPay(token, orderID)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// assertPaymentSession checks a PaymentSessionDetail answer with status
// against the contract and returns the payment.
func assertPaymentSession(t *testing.T, resp response, status int, what string) paymentOut {
	t.Helper()
	if resp.Status != status {
		t.Fatalf("%s = %d, want %d: %s", what, resp.Status, status, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "PaymentSessionDetail", what)
	obj := object(t, top["data"], "PaymentSession", what+" data")
	assertMoney(t, obj["amount"], what+".amount")
	assertTimestamp(t, obj["expires_at"], what+".expires_at")
	assertTimestamp(t, obj["created_at"], what+".created_at")
	var p paymentOut
	if err := json.Unmarshal(top["data"], &p); err != nil {
		t.Fatalf("%s: %v", what, err)
	}
	if !uuidPattern.MatchString(p.ID) || !uuidPattern.MatchString(p.OrderID) ||
		(p.Provider != "midtrans" && p.Provider != "fake") || (p.Status != "pending" && p.Status != "challenge") ||
		p.Token == "" || !strings.HasPrefix(p.RedirectURL, "https://") || p.ClientKey == "" {
		t.Errorf("%s: %+v breaks the contract", what, p)
	}
	return p
}

// paid places an order for b and opens its payment: the order and the
// payment's gateway order_id.
func (ps *payShop) paid(t *testing.T, b buyer, lines ...line) (orderOut, paymentOut, string) {
	t.Helper()
	o := ps.order(t, b, lines...)
	p := assertPaymentSession(t, ps.pay(t, b.Token, o.ID), http.StatusCreated, "pay")
	return o, p, ps.providerOrderID(t, p.ID)
}

// providerOrderID is the order_id the gateway knows payment id by.
func (sh *shop) providerOrderID(t *testing.T, paymentID string) string {
	t.Helper()
	ids := queryStrings(t, sh.db, `SELECT provider_order_id FROM payments WHERE id = $1`, paymentID)
	if len(ids) != 1 {
		t.Fatalf("payment %s not found", paymentID)
	}
	return ids[0]
}

// notification is what the fake gateway sends when the transaction
// providerOrderID takes status (fraud only matters for capture).
func (ps *payShop) notification(t *testing.T, providerOrderID, status, fraud string) payment.Notification {
	t.Helper()
	n, err := ps.gw.Pay(t.Context(), providerOrderID, status, fraud)
	if err != nil {
		t.Fatalf("fake gateway: %s → %s: %v", providerOrderID, status, err)
	}
	return n
}

// tryNotify posts a notification body (a Notification, or a raw string)
// to the webhook, as Midtrans does: no token, JSON.
func (sh *shop) tryNotify(body any) (response, error) {
	return sh.tryCall(http.MethodPost, "/v1/payments/midtrans/notification", body, "", nil)
}

// notify is tryNotify that fails the test on a transport error.
func (sh *shop) notify(t *testing.T, body any) response {
	t.Helper()
	resp, err := sh.tryNotify(body)
	if err != nil {
		t.Fatal(err)
	}
	return resp
}

// gatewaySays sets the transaction's status at the fake gateway and posts
// the notification, returning the webhook's answer.
func (ps *payShop) gatewaySays(t *testing.T, providerOrderID, status, fraud string) response {
	t.Helper()
	return ps.notify(t, ps.notification(t, providerOrderID, status, fraud))
}

// assertOutcome fails unless resp is 200 NotificationResultDetail with
// outcome.
func assertOutcome(t *testing.T, resp response, outcome, what string) {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %d, want 200 %s: %s", what, resp.Status, outcome, resp.Body)
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "NotificationResultDetail", what)
	object(t, top["data"], "NotificationResult", what+" data")
	var r struct {
		Outcome string `json:"outcome"`
	}
	if err := json.Unmarshal(top["data"], &r); err != nil {
		t.Fatal(err)
	}
	if r.Outcome != outcome {
		t.Errorf("%s: outcome %q, want %q", what, r.Outcome, outcome)
	}
}

// paymentRow is a payments row as the tests read it.
type paymentRow struct {
	Status         string
	RefundRequired bool
	Paid           bool
	Checked        bool
	FinalChecked   bool
	ProviderStatus string
}

// paymentRow reads payment id.
func (sh *shop) paymentRow(t *testing.T, id string) paymentRow {
	t.Helper()
	var p paymentRow
	var provider sql.NullString
	err := sh.db.QueryRowContext(t.Context(), `SELECT status, refund_required_at IS NOT NULL, paid_at IS NOT NULL,
		checked_at IS NOT NULL, final_checked_at IS NOT NULL, provider_status FROM payments WHERE id = $1`, id).
		Scan(&p.Status, &p.RefundRequired, &p.Paid, &p.Checked, &p.FinalChecked, &provider)
	if err != nil {
		t.Fatalf("read payment %s: %v", id, err)
	}
	p.ProviderStatus = provider.String
	return p
}

// paymentEvents lists a payment's recorded outcomes as "source:status:outcome", oldest first.
func (sh *shop) paymentEvents(t *testing.T, paymentID string) []string {
	t.Helper()
	return queryStrings(t, sh.db, `SELECT source || ':' || transaction_status || ':' || outcome FROM payment_events
		WHERE payment_id = $1 ORDER BY received_at, id`, paymentID)
}

// orderStatus is an order's status in PostgreSQL.
func (sh *shop) orderStatus(t *testing.T, orderID string) string {
	t.Helper()
	s := queryStrings(t, sh.db, `SELECT status FROM orders WHERE id = $1`, orderID)
	if len(s) != 1 {
		t.Fatalf("order %s not found", orderID)
	}
	return s[0]
}

// openPayments is how many open payments (pending, challenge) order has.
func (sh *shop) openPayments(t *testing.T, orderID string) int {
	t.Helper()
	return sh.count(t, `SELECT count(*) FROM payments WHERE order_id = $1 AND status IN ('pending', 'challenge')`, orderID)
}

// assertLogged fails unless the server logged a line holding every part.
func assertLogged(t *testing.T, s *server, parts ...string) {
	t.Helper()
	for line := range strings.Lines(s.logs.String()) {
		all := true
		for _, p := range parts {
			if !strings.Contains(line, p) {
				all = false
				break
			}
		}
		if all {
			return
		}
	}
	t.Errorf("no log line holds %q; logs:\n%s", parts, s.logs.String())
}

// sandboxServerKey and sandboxClientKey are made-up Midtrans sandbox keys
// (the configuration accepts only the SB-Mid- prefixes; short, so make
// scan does not take them for real keys); fakeMidtrans
// signs with the first.
const (
	sandboxServerKey = "SB-Mid-server-it"
	sandboxClientKey = "SB-Mid-client-it"
)

// fakeMidtrans is Midtrans at the HTTP boundary: Snap's
// POST /snap/v1/transactions and the status API's GET /v2/{id}/status,
// with Basic auth checked. A test sets the status answer per order_id.
type fakeMidtrans struct {
	srv *httptest.Server

	mu sync.Mutex
	// snapBodies are the Snap requests received, decoded.
	snapBodies []map[string]any
	// statuses are the status answers by order_id; a missing one is 404.
	statuses map[string]map[string]string
	// badSignature makes every status answer carry a wrong signature_key.
	badSignature bool
	// statusCalls counts the status API calls.
	statusCalls int
}

// newFakeMidtrans starts a fake Midtrans for the test.
func newFakeMidtrans(t *testing.T) *fakeMidtrans {
	t.Helper()
	f := &fakeMidtrans{statuses: map[string]map[string]string{}}
	f.srv = httptest.NewServer(http.HandlerFunc(f.serve))
	t.Cleanup(f.srv.Close)
	return f
}

// gateway is the real Midtrans client pointed at f.
func (f *fakeMidtrans) gateway() *midtrans.Client {
	return midtrans.New(sandboxServerKey, sandboxClientKey, 5*time.Second, midtrans.WithBaseURLs(f.srv.URL, f.srv.URL))
}

// set makes the status API answer status for orderID, with amount as
// gross_amount, signed with the sandbox key.
func (f *fakeMidtrans) set(orderID, status, fraud, amount string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	code := map[string]string{"settlement": "200", "capture": "200", "pending": "201", "expire": "407", "deny": "202"}[status]
	if code == "" {
		code = "200"
	}
	f.statuses[orderID] = map[string]string{
		"status_code": code, "order_id": orderID, "transaction_id": "mt-" + orderID, "transaction_status": status,
		"fraud_status": fraud, "payment_type": "bank_transfer", "gross_amount": amount,
	}
}

// notification is the signed notification Midtrans would send about
// orderID's current status.
func (f *fakeMidtrans) notification(orderID string) payment.Notification {
	f.mu.Lock()
	defer f.mu.Unlock()
	st := f.statuses[orderID]
	return payment.Notification{
		OrderID: orderID, StatusCode: st["status_code"], GrossAmount: st["gross_amount"],
		SignatureKey: midtrans.Signature(sandboxServerKey, orderID, st["status_code"], st["gross_amount"]),
	}
}

func (f *fakeMidtrans) serve(w http.ResponseWriter, r *http.Request) {
	user, pass, ok := r.BasicAuth()
	if !ok || user != sandboxServerKey || pass != "" {
		w.WriteHeader(http.StatusUnauthorized)
		return
	}
	f.mu.Lock()
	defer f.mu.Unlock()
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/snap/v1/transactions":
		var body map[string]any
		raw, _ := io.ReadAll(r.Body)
		if json.Unmarshal(raw, &body) != nil {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		f.snapBodies = append(f.snapBodies, body)
		token := "snap-" + strings.ToLower(rand.Text()[:16])
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusCreated)
		_ = json.NewEncoder(w).Encode(map[string]string{
			"token": token, "redirect_url": "https://app.sandbox.midtrans.com/snap/v4/redirection/" + token,
		})
	case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v2/") && strings.HasSuffix(r.URL.Path, "/status"):
		f.statusCalls++
		id := strings.TrimSuffix(strings.TrimPrefix(r.URL.Path, "/v2/"), "/status")
		st, ok := f.statuses[id]
		if !ok {
			w.WriteHeader(http.StatusNotFound)
			_, _ = io.WriteString(w, `{"status_code":"404","status_message":"Transaction doesn't exist."}`)
			return
		}
		out := map[string]string{}
		for k, v := range st {
			out[k] = v
		}
		out["signature_key"] = midtrans.Signature(sandboxServerKey, id, st["status_code"], st["gross_amount"])
		if f.badSignature {
			out["signature_key"] = midtrans.Signature("SB-Mid-server-other", id, st["status_code"], st["gross_amount"])
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(out)
	default:
		w.WriteHeader(http.StatusNotFound)
	}
}

// snapRequests is a copy of the Snap requests received.
func (f *fakeMidtrans) snapRequests() []map[string]any {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]map[string]any(nil), f.snapBodies...)
}

// calls is how many status API calls f answered.
func (f *fakeMidtrans) calls() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.statusCalls
}

// rupiahAmount is amount as Midtrans writes it: "117000.00".
func rupiahAmount(amount int64) string { return strconv.FormatInt(amount, 10) + ".00" }

// midtransShop is a shop paying through the real Midtrans client against
// a fake Midtrans.
func midtransShop(t *testing.T, env map[string]string) (*shop, *fakeMidtrans) {
	t.Helper()
	f := newFakeMidtrans(t)
	return newShop(t, env, app.WithPaymentGateway(f.gateway())), f
}

// staffShop is a server with a catalog and an admin, without the
// unlimited rate limiter: the real Redis limits count.
func staffShop(t *testing.T, env map[string]string, opts ...app.Option) *shop {
	t.Helper()
	s := startServer(t, env, opts...)
	return &shop{server: s, cat: newCatalog(t, s.db), staff: s.accountWithRole(t, user.RoleAdmin).AccessToken}
}
