package order

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/ctxx"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// fakeOrders is the handlers' Checkout, Orders and Staff in one: it
// records each call and answers from its fields.
type fakeOrders struct {
	calls []string
	err   error // returned by every call
	// moveErr is returned by the status changes only, so the read after
	// them can still succeed.
	moveErr error

	preview   Preview
	previewIn PreviewInput
	quotes    Quotes
	resp      Response
	idem      Idempotency
	checkout  CheckoutInput
	order     Order
	page      Page
	pageArgs  []any
	users     []string
}

func (f *fakeOrders) rec(call, user string) {
	f.calls = append(f.calls, call)
	f.users = append(f.users, user)
}

func (f *fakeOrders) Preview(_ context.Context, userID string, in PreviewInput) (Preview, error) {
	f.rec("Preview", userID)
	f.previewIn = in
	return f.preview, f.err
}

func (f *fakeOrders) ShippingQuotes(_ context.Context, userID, addressID string) (Quotes, error) {
	f.rec("ShippingQuotes "+addressID, userID)
	return f.quotes, f.err
}

func (f *fakeOrders) Checkout(_ context.Context, userID string, idem Idempotency, in CheckoutInput) (Response, error) {
	f.rec("Checkout", userID)
	f.idem, f.checkout = idem, in
	return f.resp, f.err
}

func (f *fakeOrders) Get(_ context.Context, userID, id string) (Order, error) {
	f.rec("Get "+id, userID)
	o := f.order
	o.ID = id
	return o, f.err
}

func (f *fakeOrders) History(_ context.Context, userID, cursor string, limit int) (Page, error) {
	f.rec("History", userID)
	f.pageArgs = []any{cursor, limit}
	return f.page, f.err
}

func (f *fakeOrders) Complete(_ context.Context, buyerID, id string) error {
	f.rec("Complete "+id, buyerID)
	return errors.Join(f.err, f.moveErr)
}

func (f *fakeOrders) CancelByBuyer(_ context.Context, buyerID, id string) error {
	f.rec("CancelByBuyer "+id, buyerID)
	return errors.Join(f.err, f.moveErr)
}

func (f *fakeOrders) GetForStaff(_ context.Context, id string) (Order, error) {
	f.rec("GetForStaff "+id, "")
	o := f.order
	o.ID = id
	return o, f.err
}

func (f *fakeOrders) Queue(_ context.Context, status Status, cursor string, limit int) (Page, error) {
	f.rec("Queue", "")
	f.pageArgs = []any{status, cursor, limit}
	return f.page, f.err
}

func (f *fakeOrders) StartProcessing(_ context.Context, id string) error {
	f.rec("StartProcessing "+id, "")
	return errors.Join(f.err, f.moveErr)
}

func (f *fakeOrders) Ship(_ context.Context, id, trackingNumber string) error {
	f.rec("Ship "+id+" "+trackingNumber, "")
	return errors.Join(f.err, f.moveErr)
}

func (f *fakeOrders) CancelBySeller(_ context.Context, id string) error {
	f.rec("CancelBySeller "+id, "")
	return errors.Join(f.err, f.moveErr)
}

func sampleOrder() Order {
	reason := CancelBuyerCancelled
	tracking := "JNE123456"
	voucher := "HEMAT10"
	wib := time.FixedZone("WIB", 7*3600)
	paid := time.Date(2026, 10, 23, 16, 0, 0, 0, wib)
	return Order{
		Code: "GS-20261023-ABC123", UserID: buyerID, Status: StatusCancelled, CancelReason: &reason,
		Totals:      Totals{Subtotal: 120000, Discount: 12000, ShippingFee: 9000, Total: 117000, WeightGrams: 500},
		VoucherCode: &voucher, Courier: "sicepat", CourierService: "REG", TrackingNumber: &tracking,
		Address:          ShippingAddress{Recipient: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1", City: "Bandung", Province: "Jawa Barat", PostalCode: "40111"},
		Items:            []Item{{ID: "item-1", VariantID: v1, ProductName: "Kaos", VariantName: "M", SKU: "SKU-1", UnitPrice: 60000, Quantity: 2, LineTotal: 120000}},
		PaymentExpiresAt: time.Date(2026, 10, 24, 15, 0, 0, 0, wib), PaidAt: &paid,
		CreatedAt: time.Date(2026, 10, 23, 15, 0, 0, 0, wib), UpdatedAt: time.Date(2026, 10, 23, 17, 0, 0, 0, wib),
	}
}

func newOrderRouter(f *fakeOrders) chi.Router {
	h := NewHandler(f, f, f, httpapi.NewValidator())
	r := chi.NewRouter()
	h.Routes(r)
	r.Route("/admin", h.AdminRoutes)
	return r
}

// serveOrder sends method path with body as the buyer, with header.
func serveOrder(f *fakeOrders, method, path, body string, header map[string]string) *httptest.ResponseRecorder {
	ctx := ctxx.WithUserID(context.Background(), buyerID)
	req := httptest.NewRequestWithContext(ctx, method, path, strings.NewReader(body))
	for k, v := range header {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	newOrderRouter(f).ServeHTTP(rec, req)
	return rec
}

type errorBody struct {
	Error struct {
		Code    string         `json:"code"`
		Message string         `json:"message"`
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

func decodeData(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	var b struct {
		Data map[string]any `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	return b.Data
}

// Every error the service returns has its answer.
func TestToHTTPError(t *testing.T) {
	tests := []struct {
		name    string
		err     error
		status  int
		code    string
		details map[string]any
	}{
		{name: "invalid transition", err: fmt.Errorf("order x to cancelled: %w", &TransitionError{Current: StatusShipped, To: StatusCancelled}),
			status: 409, code: CodeInvalidTransition, details: map[string]any{"status": "shipped", "to": "cancelled"}},
		{name: "invalid cursor", err: fmt.Errorf("%w: not base64url", ErrInvalidCursor), status: 400, code: httpapi.CodeValidationFailed,
			details: map[string]any{"cursor": "is not a cursor from page.next_cursor for this list; start again without it"}},
		{name: "voucher", err: &VoucherError{Code: "HEMAT10", Reason: VoucherExpired}, status: 409, code: CodeVoucher,
			details: map[string]any{"voucher_code": "HEMAT10", "reason": "expired"}},
		{name: "voucher min spend", err: &VoucherError{Code: "HEMAT10", Reason: VoucherMinSpend, MinSpend: 100000}, status: 409, code: CodeVoucher,
			details: map[string]any{"voucher_code": "HEMAT10", "reason": "min_spend", "min_spend": map[string]any{"amount": float64(100000), "currency": "IDR"}}},
		{name: "not found", err: fmt.Errorf("get order: %w", ErrNotFound), status: 404, code: httpapi.CodeNotFound},
		{name: "key reused", err: ErrIdempotencyKeyReused, status: 422, code: CodeKeyReused},
		{name: "key in progress", err: ErrIdempotencyInProgress, status: 409, code: CodeKeyInProgress},
		{name: "email unverified", err: fmt.Errorf("checkout: %w", ErrEmailUnverified), status: 403, code: CodeEmailUnverified},
		{name: "account gone", err: ErrAccountGone, status: 401, code: httpapi.CodeUnauthorized},
		{name: "too many pending", err: ErrTooManyPendingOrders, status: 409, code: CodeTooManyPending, details: map[string]any{"max": float64(5)}},
		{name: "cart changed", err: ErrCartChanged, status: 409, code: CodeCartChanged},
		{name: "unknown address", err: ErrUnknownAddress, status: 400, code: httpapi.CodeValidationFailed,
			details: map[string]any{"address_id": "names none of your addresses"}},
		{name: "unknown service", err: ErrUnknownShippingService, status: 400, code: httpapi.CodeValidationFailed,
			details: map[string]any{"service": "is not offered for this parcel now; choose one from GET /v1/checkout/shipping-quotes"}},
		{name: "shipping down", err: fmt.Errorf("quote shipping: %w: biteship answered 500", shipping.ErrUnavailable), status: 503, code: httpapi.CodeUpstreamUnavailable},
		{name: "cart empty", err: ErrCartEmpty, status: 409, code: CodeCartEmpty},
		{name: "problems", err: &ProblemsError{Lines: []LineProblem{{VariantID: v1, SKU: "SKU-1", Problem: cart.ProblemPriceChanged, Quantity: 2, Available: 9, AddedPrice: 1000, Price: 1200}}},
			status: 409, code: CodeCheckoutProblems, details: map[string]any{"lines": []any{map[string]any{
				"variant_id": v1, "sku": "SKU-1", "problem": "price_changed", "quantity": float64(2), "available": float64(9),
				"unit_price":       map[string]any{"amount": float64(1200), "currency": "IDR"},
				"price_when_added": map[string]any{"amount": float64(1000), "currency": "IDR"},
			}}}},
		{name: "anything else", err: errBoom, status: 500, code: httpapi.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/", nil)
			httpapi.Error(rec, req, toHTTPError(tt.err))
			b := assertError(t, rec, tt.status, tt.code)
			if tt.details != nil {
				got, _ := json.Marshal(b.Error.Details)
				want, _ := json.Marshal(tt.details)
				testx.AssertEqual(t, string(got), string(want))
			}
			testx.AssertFalse(t, strings.Contains(rec.Body.String(), "biteship"), "no upstream detail reaches the client")
		})
	}
}

func TestCheckChoice(t *testing.T) {
	tests := []struct {
		name                      string
		address, courier, service string
		want                      map[string]any
	}{
		{name: "nothing chosen", want: map[string]any{}},
		{name: "address only", address: addressID, want: map[string]any{}},
		{name: "everything", address: addressID, courier: "jne", service: "REG", want: map[string]any{}},
		{name: "courier without service", address: addressID, courier: "jne", want: map[string]any{"service": "is required with courier"}},
		{name: "service without courier", address: addressID, service: "REG", want: map[string]any{"courier": "is required with service"}},
		{name: "courier and service without address", courier: "jne", service: "REG", want: map[string]any{"address_id": "is required to price shipping"}},
		{name: "courier alone: the service first", courier: "jne", want: map[string]any{"service": "is required with courier"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			details := map[string]any{}
			checkChoice(details, tt.address, tt.courier, tt.service)
			testx.AssertEqual(t, fmt.Sprint(details), fmt.Sprint(tt.want))
		})
	}
}

func TestHandler_Preview(t *testing.T) {
	f := &fakeOrders{preview: Preview{
		Lines:    []cart.Line{line(v1, 2, 60000, 5)},
		Totals:   Totals{Subtotal: 120000, Discount: 12000, ShippingFee: 9000, Total: 117000, WeightGrams: 500},
		Shipping: &shipping.Quote{Courier: shipping.CourierSiCepat, CourierName: "SiCepat", Service: "REG", ServiceName: "Reguler", Price: 9000, ETD: "2-3 days"},
		Voucher:  func() *Voucher { v := hemat10(); return &v }(),
	}}
	rec := serveOrder(f, http.MethodPost, "/checkout/preview",
		`{"address_id":"`+addressID+`","courier":"sicepat","service":"REG","voucher_code":"hemat10"}`, nil)
	data := decodeData(t, rec)
	testx.AssertEqual(t, f.previewIn, PreviewInput{AddressID: addressID, Courier: shipping.CourierSiCepat, Service: "REG", VoucherCode: "HEMAT10"})
	testx.AssertEqual(t, f.users[0], buyerID)
	b, _ := json.Marshal(data["totals"])
	testx.AssertEqual(t, string(b), `{"discount":{"amount":12000,"currency":"IDR"},"shipping_fee":{"amount":9000,"currency":"IDR"},"subtotal":{"amount":120000,"currency":"IDR"},"total":{"amount":117000,"currency":"IDR"},"weight_grams":500}`)
	b, _ = json.Marshal(data["shipping"])
	testx.AssertEqual(t, string(b), `{"courier":"sicepat","courier_name":"SiCepat","etd":"2-3 days","price":{"amount":9000,"currency":"IDR"},"service":"REG","service_name":"Reguler"}`)
	b, _ = json.Marshal(data["voucher"])
	testx.AssertEqual(t, string(b), `{"code":"HEMAT10","kind":"percent","max_discount":{"amount":25000,"currency":"IDR"},"value":10}`)
	testx.AssertEqual(t, len(data["lines"].([]any)), 1)

	t.Run("nothing chosen yet: shipping and voucher are null", func(t *testing.T) {
		f := &fakeOrders{preview: Preview{Lines: []cart.Line{line(v1, 1, 5, 5)}, Totals: Totals{Subtotal: 5, Total: 5}}}
		data := decodeData(t, serveOrder(f, http.MethodPost, "/checkout/preview", `{}`, nil))
		testx.AssertTrue(t, data["shipping"] == nil && data["voucher"] == nil)
		testx.AssertEqual(t, f.previewIn, PreviewInput{})
	})
	t.Run("a fixed voucher has no max_discount", func(t *testing.T) {
		f := &fakeOrders{preview: Preview{Voucher: &Voucher{Code: "POTONG15RB", Kind: VoucherFixed, Value: 15000}}}
		data := decodeData(t, serveOrder(f, http.MethodPost, "/checkout/preview", `{}`, nil))
		b, _ := json.Marshal(data["voucher"])
		testx.AssertEqual(t, string(b), `{"code":"POTONG15RB","kind":"fixed","max_discount":null,"value":15000}`)
	})
	bad := []struct {
		name string
		body string
		keys []string
	}{
		{name: "courier without service", body: `{"address_id":"` + addressID + `","courier":"jne"}`, keys: []string{"service"}},
		{name: "courier without address", body: `{"courier":"jne","service":"REG"}`, keys: []string{"address_id"}},
		{name: "unknown courier", body: `{"address_id":"` + addressID + `","courier":"pos","service":"REG"}`, keys: []string{"courier"}},
		{name: "address not a UUID and a short voucher", body: `{"address_id":"x","voucher_code":"ab"}`, keys: []string{"address_id", "voucher_code"}},
		{name: "voucher with a symbol", body: `{"voucher_code":"HEMAT-10"}`, keys: []string{"voucher_code"}},
		{name: "unknown field", body: `{"total":1}`, keys: []string{"body"}},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeOrders{}
			b := assertError(t, serveOrder(f, http.MethodPost, "/checkout/preview", tt.body, nil), 400, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, len(b.Error.Details), len(tt.keys), "details %v", b.Error.Details)
			for _, k := range tt.keys {
				testx.AssertTrue(t, b.Error.Details[k] != nil, "details[%s] in %v", k, b.Error.Details)
			}
			testx.AssertEqual(t, len(f.calls), 0)
		})
	}
	t.Run("a service error", func(t *testing.T) {
		f := &fakeOrders{err: ErrCartEmpty}
		assertError(t, serveOrder(f, http.MethodPost, "/checkout/preview", `{}`, nil), 409, CodeCartEmpty)
	})
}

func TestHandler_ShippingQuotes(t *testing.T) {
	f := &fakeOrders{quotes: Quotes{WeightGrams: 1250, Quotes: []shipping.Quote{
		{Courier: shipping.CourierSiCepat, CourierName: "SiCepat", Service: "REG", ServiceName: "Reguler", Price: 18000, ETD: "2-3 days"},
	}}}
	data := decodeData(t, serveOrder(f, http.MethodGet, "/checkout/shipping-quotes?address_id="+addressID, "", nil))
	testx.AssertEqual(t, f.calls[0], "ShippingQuotes "+addressID)
	testx.AssertEqual(t, data["weight_grams"], any(float64(1250)))
	b, _ := json.Marshal(data["quotes"])
	testx.AssertEqual(t, string(b), `[{"courier":"sicepat","courier_name":"SiCepat","etd":"2-3 days","price":{"amount":18000,"currency":"IDR"},"service":"REG","service_name":"Reguler"}]`)

	f = &fakeOrders{}
	data = decodeData(t, serveOrder(f, http.MethodGet, "/checkout/shipping-quotes?address_id="+addressID, "", nil))
	testx.AssertEqual(t, string(must(json.Marshal(data["quotes"]))), `[]`, "no quotes is [], not null")

	for _, q := range []string{"", "?address_id=nope"} {
		f := &fakeOrders{}
		assertError(t, serveOrder(f, http.MethodGet, "/checkout/shipping-quotes"+q, "", nil), 400, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(f.calls), 0)
	}
	f = &fakeOrders{err: fmt.Errorf("shipping quotes: %w", shipping.ErrUnavailable)}
	assertError(t, serveOrder(f, http.MethodGet, "/checkout/shipping-quotes?address_id="+addressID, "", nil), 503, httpapi.CodeUpstreamUnavailable)
}

func must(b []byte, err error) []byte {
	if err != nil {
		panic(err)
	}
	return b
}

func TestValidIdempotencyKey(t *testing.T) {
	tests := []struct {
		key  string
		want bool
	}{
		{"0190c8a0-0000-7000-8000-000000000001", true},
		{"a", true},
		{strings.Repeat("k", 255), true},
		{"!~", true}, // the printable ends
		{"", false},
		{strings.Repeat("k", 256), false},
		{"with space", false},
		{"tab\there", false},
		{"kunci-ü", false},
		{"del\x7f", false},
		{"nl\n", false},
	}
	for _, tt := range tests {
		testx.AssertEqual(t, validIdempotencyKey(tt.key), tt.want, "key %q", tt.key)
	}
}

func checkoutBodyJSON(voucher string) string {
	return `{"address_id":"` + addressID + `","courier":"jne","service":"REG","voucher_code":"` + voucher + `"}`
}

func TestHandler_Checkout(t *testing.T) {
	t.Run("201 with the stored bytes and Location", func(t *testing.T) {
		f := &fakeOrders{resp: Response{Status: http.StatusCreated, Body: []byte("{\"data\":{\"id\":\"" + orderID1 + "\"}}\n"), OrderID: orderID1}}
		rec := serveOrder(f, http.MethodPost, "/checkout", checkoutBodyJSON("hemat10"), map[string]string{HeaderIdempotencyKey: "key-1"})
		testx.AssertEqual(t, rec.Code, http.StatusCreated)
		testx.AssertEqual(t, rec.Body.String(), "{\"data\":{\"id\":\""+orderID1+"\"}}\n", "the body byte for byte")
		testx.AssertEqual(t, rec.Header().Get("Location"), "/v1/orders/"+orderID1)
		testx.AssertEqual(t, rec.Header().Get("Content-Type"), "application/json; charset=utf-8")
		testx.AssertEqual(t, rec.Header().Get(HeaderReplayed), "", "a first answer is not a replay")
		testx.AssertEqual(t, f.idem.Key, "key-1")
		testx.AssertEqual(t, f.checkout, CheckoutInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "REG", VoucherCode: "HEMAT10"})
		testx.AssertEqual(t, f.users[0], buyerID)
	})
	t.Run("a replay says so", func(t *testing.T) {
		f := &fakeOrders{resp: Response{Status: http.StatusCreated, Body: []byte(`{}`), OrderID: orderID1, Replayed: true}}
		rec := serveOrder(f, http.MethodPost, "/checkout", checkoutBodyJSON(""), map[string]string{HeaderIdempotencyKey: "key-1"})
		testx.AssertEqual(t, rec.Code, http.StatusCreated)
		testx.AssertEqual(t, rec.Header().Get(HeaderReplayed), "true")
	})
	t.Run("the hash is of the normalized body", func(t *testing.T) {
		hash := func(body string) []byte {
			f := &fakeOrders{resp: Response{Status: 201}}
			serveOrder(f, http.MethodPost, "/checkout", body, map[string]string{HeaderIdempotencyKey: "k"})
			return f.idem.RequestHash
		}
		a := hash(checkoutBodyJSON("hemat10"))
		testx.AssertEqual(t, len(a), 32)
		testx.AssertEqual(t, string(hash(checkoutBodyJSON("HEMAT10"))), string(a), "the code's case does not matter")
		testx.AssertEqual(t, string(hash(`{ "service":"REG", "courier":"jne",`+"\n"+` "voucher_code":"hemat10", "address_id":"`+addressID+`"}`)), string(a),
			"nor whitespace or key order")
		testx.AssertNotEqual(t, string(hash(checkoutBodyJSON(""))), string(a), "another voucher is another request")
	})
	for name, key := range map[string]string{"missing": "", "too long": strings.Repeat("k", 256), "a space": "my key", "non-ASCII": "kunci-é"} {
		t.Run("a bad key is 400 before anything: "+name, func(t *testing.T) {
			f := &fakeOrders{}
			header := map[string]string{}
			if key != "" {
				header[HeaderIdempotencyKey] = key
			}
			b := assertError(t, serveOrder(f, http.MethodPost, "/checkout", "not even json", header), 400, CodeKeyRequired)
			testx.AssertContains(t, b.Error.Message, "Idempotency-Key")
			testx.AssertEqual(t, len(f.calls), 0)
		})
	}
	bad := []struct {
		name string
		body string
		keys []string
	}{
		{name: "empty object", body: `{}`, keys: []string{"address_id", "courier", "service"}},
		{name: "unknown courier", body: `{"address_id":"` + addressID + `","courier":"pos","service":"REG"}`, keys: []string{"courier"}},
		{name: "long service", body: `{"address_id":"` + addressID + `","courier":"jne","service":"` + strings.Repeat("S", 21) + `"}`, keys: []string{"service"}},
		{name: "voucher too long", body: checkoutBodyJSON(strings.Repeat("A", 33)), keys: []string{"voucher_code"}},
		{name: "a client total is refused", body: `{"address_id":"` + addressID + `","courier":"jne","service":"REG","total":1}`, keys: []string{"body"}},
	}
	for _, tt := range bad {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeOrders{}
			b := assertError(t, serveOrder(f, http.MethodPost, "/checkout", tt.body, map[string]string{HeaderIdempotencyKey: "k"}), 400, httpapi.CodeValidationFailed)
			testx.AssertEqual(t, len(b.Error.Details), len(tt.keys), "details %v", b.Error.Details)
			testx.AssertEqual(t, len(f.calls), 0)
		})
	}
	errs := []struct {
		err    error
		status int
		code   string
	}{
		{ErrIdempotencyKeyReused, 422, CodeKeyReused},
		{ErrIdempotencyInProgress, 409, CodeKeyInProgress},
		{fmt.Errorf("checkout: %w", ErrEmailUnverified), 403, CodeEmailUnverified},
	}
	for _, tt := range errs {
		t.Run(tt.code, func(t *testing.T) {
			f := &fakeOrders{err: tt.err}
			rec := serveOrder(f, http.MethodPost, "/checkout", checkoutBodyJSON(""), map[string]string{HeaderIdempotencyKey: "k"})
			assertError(t, rec, tt.status, tt.code)
			testx.AssertEqual(t, rec.Header().Get("Location"), "")
		})
	}
}

func TestHandler_History(t *testing.T) {
	o := sampleOrder()
	o.ID = orderID1
	f := &fakeOrders{page: Page{Orders: []Order{o}, NextCursor: "next"}}
	rec := serveOrder(f, http.MethodGet, "/orders", "", nil)
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, fmt.Sprint(f.pageArgs), "[ 20]", "no cursor, 20 per page by default")
	testx.AssertEqual(t, f.users[0], buyerID)
	var body struct {
		Data []map[string]any `json:"data"`
		Page struct {
			NextCursor *string `json:"next_cursor"`
		} `json:"page"`
	}
	testx.AssertNoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	testx.AssertEqual(t, len(body.Data), 1)
	testx.AssertEqual(t, body.Data[0]["code"], any("GS-20261023-ABC123"))
	testx.AssertEqual(t, body.Data[0]["status"], any("cancelled"))
	testx.AssertEqual(t, body.Data[0]["created_at"], any("2026-10-23T08:00:00Z"), "in UTC")
	_, hasItems := body.Data[0]["items"]
	testx.AssertFalse(t, hasItems, "a list shows no items")
	testx.AssertEqual(t, *body.Page.NextCursor, "next")

	f = &fakeOrders{}
	rec = serveOrder(f, http.MethodGet, "/orders?cursor=abc&limit=50", "", nil)
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, fmt.Sprint(f.pageArgs), "[abc 50]")
	testx.AssertContains(t, rec.Body.String(), `"data":[],"page":{"next_cursor":null}`)

	for _, q := range []string{"?limit=0", "?limit=51", "?limit=x", "?cursor=" + strings.Repeat("c", 513)} {
		f := &fakeOrders{}
		assertError(t, serveOrder(f, http.MethodGet, "/orders"+q, "", nil), 400, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(f.calls), 0, "query %s", q)
	}
	f = &fakeOrders{err: fmt.Errorf("%w: not a cursor", ErrInvalidCursor)}
	b := assertError(t, serveOrder(f, http.MethodGet, "/orders?cursor=zz", "", nil), 400, httpapi.CodeValidationFailed)
	testx.AssertTrue(t, b.Error.Details["cursor"] != nil)
}

func TestHandler_GetOrder(t *testing.T) {
	f := &fakeOrders{order: sampleOrder()}
	data := decodeData(t, serveOrder(f, http.MethodGet, "/orders/"+orderID1, "", nil))
	testx.AssertEqual(t, f.calls[0], "Get "+orderID1)
	testx.AssertEqual(t, f.users[0], buyerID, "scoped by the caller")
	got, _ := json.Marshal(data)
	want := `{"cancel_reason":"buyer_cancelled","cancelled_at":null,"code":"GS-20261023-ABC123","completed_at":null,"created_at":"2026-10-23T08:00:00Z",` +
		`"id":"` + orderID1 + `","items":[{"id":"item-1","line_total":{"amount":120000,"currency":"IDR"},"product_name":"Kaos","quantity":2,"sku":"SKU-1",` +
		`"unit_price":{"amount":60000,"currency":"IDR"},"variant_id":"` + v1 + `","variant_name":"M"}],"paid_at":"2026-10-23T09:00:00Z",` +
		`"payment_expires_at":"2026-10-24T08:00:00Z","shipped_at":null,"shipping":{"address":{"city":"Bandung","phone":"081234567890","postal_code":"40111",` +
		`"province":"Jawa Barat","recipient_name":"Budi","street":"Jl. Merdeka 1"},"courier":"sicepat","service":"REG","tracking_number":"JNE123456"},` +
		`"status":"cancelled","totals":{"discount":{"amount":12000,"currency":"IDR"},"shipping_fee":{"amount":9000,"currency":"IDR"},` +
		`"subtotal":{"amount":120000,"currency":"IDR"},"total":{"amount":117000,"currency":"IDR"},"weight_grams":500},"updated_at":"2026-10-23T10:00:00Z","voucher_code":"HEMAT10"}`
	testx.AssertEqual(t, string(got), want)

	f = &fakeOrders{}
	assertError(t, serveOrder(f, http.MethodGet, "/orders/not-a-uuid", "", nil), 404, httpapi.CodeNotFound)
	testx.AssertEqual(t, len(f.calls), 0, "no query for a malformed id")

	f = &fakeOrders{err: fmt.Errorf("get order: %w", ErrNotFound)}
	assertError(t, serveOrder(f, http.MethodGet, "/orders/"+orderID1, "", nil), 404, httpapi.CodeNotFound)
}

// A buyer moves only their own order (the service gets the caller's id),
// and gets the order back as they see it.
func TestHandler_BuyerMoves(t *testing.T) {
	for path, call := range map[string]string{"cancel": "CancelByBuyer", "complete": "Complete"} {
		t.Run(path, func(t *testing.T) {
			f := &fakeOrders{order: sampleOrder()}
			data := decodeData(t, serveOrder(f, http.MethodPost, "/orders/"+orderID1+"/"+path, "", nil))
			testx.AssertEqual(t, strings.Join(f.calls, ","), call+" "+orderID1+",Get "+orderID1)
			testx.AssertEqual(t, f.users[0], buyerID)
			testx.AssertEqual(t, f.users[1], buyerID)
			testx.AssertEqual(t, data["id"], any(orderID1))

			f = &fakeOrders{moveErr: &TransitionError{Current: StatusPaid, To: StatusCancelled}}
			b := assertError(t, serveOrder(f, http.MethodPost, "/orders/"+orderID1+"/"+path, "", nil), 409, CodeInvalidTransition)
			testx.AssertEqual(t, b.Error.Details["status"], any("paid"))
			testx.AssertEqual(t, len(f.calls), 1, "no read after a refused move")

			f = &fakeOrders{moveErr: ErrNotFound}
			assertError(t, serveOrder(f, http.MethodPost, "/orders/"+orderID1+"/"+path, "", nil), 404, httpapi.CodeNotFound)

			f = &fakeOrders{}
			assertError(t, serveOrder(f, http.MethodPost, "/orders/x/"+path, "", nil), 404, httpapi.CodeNotFound)
			testx.AssertEqual(t, len(f.calls), 0)
		})
	}
	t.Run("the read after the move fails", func(t *testing.T) {
		f := &readFails{fakeOrders: fakeOrders{}}
		h := NewHandler(f, f, f, httpapi.NewValidator())
		r := chi.NewRouter()
		h.Routes(r)
		r.Route("/admin", h.AdminRoutes)
		for _, path := range []string{"/orders/" + orderID1 + "/cancel", "/admin/orders/" + orderID1 + "/process"} {
			req := httptest.NewRequestWithContext(ctxx.WithUserID(context.Background(), buyerID), http.MethodPost, path, nil)
			rec := httptest.NewRecorder()
			r.ServeHTTP(rec, req)
			assertError(t, rec, 500, httpapi.CodeInternal)
		}
	})
}

// readFails moves orders but cannot read them back.
type readFails struct{ fakeOrders }

func (f *readFails) Get(context.Context, string, string) (Order, error) { return Order{}, errBoom }
func (f *readFails) GetForStaff(context.Context, string) (Order, error) { return Order{}, errBoom }

func TestHandler_Queue(t *testing.T) {
	f := &fakeOrders{}
	rec := serveOrder(f, http.MethodGet, "/admin/orders", "", nil)
	testx.AssertEqual(t, rec.Code, http.StatusOK)
	testx.AssertEqual(t, fmt.Sprint(f.pageArgs), "[paid  20]", "the paid orders, to pack, by default")

	f = &fakeOrders{}
	serveOrder(f, http.MethodGet, "/admin/orders?status=processing&limit=5&cursor=c", "", nil)
	testx.AssertEqual(t, fmt.Sprint(f.pageArgs), "[processing c 5]")

	for _, q := range []string{"?status=refunded", "?status=", "?limit=0", "?limit=51"} {
		f := &fakeOrders{}
		assertError(t, serveOrder(f, http.MethodGet, "/admin/orders"+q, "", nil), 400, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(f.calls), 0, "query %s", q)
	}
	f = &fakeOrders{err: fmt.Errorf("%w: made for another list", ErrInvalidCursor)}
	assertError(t, serveOrder(f, http.MethodGet, "/admin/orders?cursor=x", "", nil), 400, httpapi.CodeValidationFailed)
}

func TestHandler_GetForStaff(t *testing.T) {
	f := &fakeOrders{order: sampleOrder()}
	data := decodeData(t, serveOrder(f, http.MethodGet, "/admin/orders/"+orderID1, "", nil))
	testx.AssertEqual(t, data["id"], any(orderID1))
	testx.AssertEqual(t, f.calls[0], "GetForStaff "+orderID1, "any order, not scoped by the caller")

	f = &fakeOrders{}
	assertError(t, serveOrder(f, http.MethodGet, "/admin/orders/1", "", nil), 404, httpapi.CodeNotFound)
	testx.AssertEqual(t, len(f.calls), 0)
	f = &fakeOrders{err: ErrNotFound}
	assertError(t, serveOrder(f, http.MethodGet, "/admin/orders/"+orderID1, "", nil), 404, httpapi.CodeNotFound)
}

func TestHandler_StaffMoves(t *testing.T) {
	for path, call := range map[string]string{"process": "StartProcessing", "complete": "Complete", "cancel": "CancelBySeller"} {
		t.Run(path, func(t *testing.T) {
			f := &fakeOrders{order: sampleOrder()}
			data := decodeData(t, serveOrder(f, http.MethodPost, "/admin/orders/"+orderID1+"/"+path, "", nil))
			testx.AssertEqual(t, strings.Join(f.calls, ","), call+" "+orderID1+",GetForStaff "+orderID1)
			testx.AssertEqual(t, f.users[0], "", "a staff move is not scoped to a buyer")
			testx.AssertEqual(t, data["id"], any(orderID1))

			f = &fakeOrders{moveErr: &TransitionError{Current: StatusShipped, To: StatusCancelled}}
			b := assertError(t, serveOrder(f, http.MethodPost, "/admin/orders/"+orderID1+"/"+path, "", nil), 409, CodeInvalidTransition)
			testx.AssertEqual(t, b.Error.Details["status"], any("shipped"))

			f = &fakeOrders{}
			assertError(t, serveOrder(f, http.MethodPost, "/admin/orders/zzz/"+path, "", nil), 404, httpapi.CodeNotFound)
			testx.AssertEqual(t, len(f.calls), 0)
		})
	}
}

func TestHandler_Ship(t *testing.T) {
	tests := []struct {
		body string
		want string // the stored airway bill; "" when refused
	}{
		{body: `{"tracking_number":"JNE1234567"}`, want: "JNE1234567"},
		{body: `{"tracking_number":"  jne-12345678 "}`, want: "JNE-12345678"},
		{body: `{"tracking_number":"ABC123"}`, want: "ABC123"},
		{body: `{"tracking_number":"` + strings.Repeat("A", 40) + `"}`, want: strings.Repeat("A", 40)},
		{body: `{"tracking_number":"ABC12"}`},
		{body: `{"tracking_number":"` + strings.Repeat("A", 41) + `"}`},
		{body: `{"tracking_number":"JNE 123456"}`},
		{body: `{"tracking_number":"JNE_123456"}`},
		{body: `{"tracking_number":"JNE123456;DROP"}`},
		{body: `{"tracking_number":""}`},
		{body: `{}`},
	}
	for _, tt := range tests {
		t.Run(tt.body, func(t *testing.T) {
			f := &fakeOrders{order: sampleOrder()}
			rec := serveOrder(f, http.MethodPost, "/admin/orders/"+orderID1+"/ship", tt.body, nil)
			if tt.want == "" {
				b := assertError(t, rec, 400, httpapi.CodeValidationFailed)
				testx.AssertEqual(t, b.Error.Details["tracking_number"], any("must be the courier's airway bill: 6 to 40 letters, digits or hyphens"))
				testx.AssertEqual(t, len(f.calls), 0)
				return
			}
			decodeData(t, rec)
			testx.AssertEqual(t, f.calls[0], "Ship "+orderID1+" "+tt.want)
		})
	}
	t.Run("not JSON", func(t *testing.T) {
		f := &fakeOrders{}
		assertError(t, serveOrder(f, http.MethodPost, "/admin/orders/"+orderID1+"/ship", `nope`, nil), 400, httpapi.CodeValidationFailed)
		testx.AssertEqual(t, len(f.calls), 0)
	})
	t.Run("from a status that cannot ship", func(t *testing.T) {
		f := &fakeOrders{moveErr: &TransitionError{Current: StatusPaid, To: StatusShipped}}
		b := assertError(t, serveOrder(f, http.MethodPost, "/admin/orders/"+orderID1+"/ship", `{"tracking_number":"JNE1234567"}`, nil), 409, CodeInvalidTransition)
		testx.AssertEqual(t, b.Error.Details["to"], any("shipped"))
	})
}
