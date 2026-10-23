package shipping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/santekno/sdk/httpx"
	"github.com/santekno/sdk/logx"
)

// BiteshipURL is Biteship's API. Test keys and live keys use the same URL.
const BiteshipURL = "https://api.biteship.com"

// maxBiteshipResponse bounds what is read of an answer: a rates answer is a
// few kilobytes, and a broken or hostile upstream must not fill memory.
const maxBiteshipResponse = 1 << 20

// Biteship prices parcels with Biteship's rates API
// (POST /v1/rates/couriers). Biteship prices by postal code, which every
// GoShop address has; RajaOngkir would need its own city IDs (ADR 0006).
type Biteship struct {
	client  *httpx.Client
	baseURL string
	logger  logx.Logger
}

// WithLogger makes b log Biteship's refusals (4xx) at WARN through logger;
// without it they are not logged. It returns b.
func (b *Biteship) WithLogger(logger logx.Logger) *Biteship {
	b.logger = logger
	return b
}

// NewBiteship returns a Biteship provider that authenticates with apiKey
// and gives up on a request after timeout. baseURL is BiteshipURL, or a
// test server.
func NewBiteship(apiKey, baseURL string, timeout time.Duration) *Biteship {
	return &Biteship{
		baseURL: strings.TrimRight(baseURL, "/"),
		// sdk httpx: a total timeout per request and a circuit breaker
		// that fails fast after repeated errors. No retries: checkout is
		// waiting, and the buyer can press the button again.
		client: httpx.New(
			httpx.WithTimeout(timeout),
			httpx.WithRetries(0),
			// Biteship takes the key as it is, without "Bearer".
			httpx.WithDefaultHeader("Authorization", apiKey),
		),
	}
}

// Name implements Provider.
func (b *Biteship) Name() string { return "biteship" }

// biteshipRequest is the body of POST /v1/rates/couriers.
type biteshipRequest struct {
	OriginPostalCode      int            `json:"origin_postal_code"`
	DestinationPostalCode int            `json:"destination_postal_code"`
	Couriers              string         `json:"couriers"`
	Items                 []biteshipItem `json:"items"`
}

type biteshipItem struct {
	Name     string `json:"name"`
	Value    int64  `json:"value"`
	Weight   int64  `json:"weight"` // grams
	Quantity int    `json:"quantity"`
}

// biteshipResponse is the part of the answer GoShop reads.
type biteshipResponse struct {
	Success bool `json:"success"`
	Pricing []struct {
		CourierCode        string `json:"courier_code"`
		CourierName        string `json:"courier_name"`
		CourierServiceCode string `json:"courier_service_code"`
		CourierServiceName string `json:"courier_service_name"`
		Duration           string `json:"duration"`
		Price              int64  `json:"price"`
	} `json:"pricing"`
}

// Quote implements Provider. The whole order is sent as one item of its
// total weight and value: the rate depends on those, not on the lines.
func (b *Biteship) Quote(ctx context.Context, req Request) ([]Quote, error) {
	body, err := b.requestBody(req)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, b.baseURL+"/v1/rates/couriers", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("biteship: build request: %w", err)
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "application/json")

	// Client.Do rather than PostJSON: PostJSON reads the whole answer
	// without a size limit, and puts up to 4 KiB of an error answer in the
	// error text (docs/sdk-gaps.md).
	//
	// WithoutCancel: httpx's circuit breaker counts every transport error,
	// a client hanging up (context.Canceled) included, as an upstream
	// failure, and five in a row open it for every buyer. So the call does
	// not end with the buyer's request; APP_SHIPPING_TIMEOUT (httpx's own
	// timeout) still bounds it.
	resp, err := b.client.Do(context.WithoutCancel(ctx), httpReq)
	if err != nil {
		return nil, fmt.Errorf("%w: biteship: %w", ErrUnavailable, err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode >= 400 && resp.StatusCode < 500 {
		b.logRefusal(resp)
	}
	switch {
	case resp.StatusCode == http.StatusBadRequest, resp.StatusCode == http.StatusNotFound,
		resp.StatusCode == http.StatusUnprocessableEntity:
		// Biteship refused this parcel (an unknown or unserved postal
		// code), not the request: no courier serves the address.
		return nil, fmt.Errorf("%w: biteship answered %d", ErrNotServed, resp.StatusCode)
	case resp.StatusCode != http.StatusOK:
		// 401/403 (our key), 429 and 5xx: Biteship is not usable now.
		return nil, fmt.Errorf("%w: biteship answered %d", ErrUnavailable, resp.StatusCode)
	}
	var out biteshipResponse
	if err := json.NewDecoder(io.LimitReader(resp.Body, maxBiteshipResponse)).Decode(&out); err != nil {
		return nil, fmt.Errorf("%w: biteship: decode answer: %w", ErrUnavailable, err)
	}
	if !out.Success {
		return nil, fmt.Errorf("%w: biteship answered success=false", ErrUnavailable)
	}
	return mapBiteship(out), nil
}

// logRefusal logs a Biteship 4xx at WARN with the status and Biteship's
// numeric error code only: never the key, the request or the message. A 400
// usually means no courier serves the address, but it can also mean
// GoShop's own request is wrong (a bad APP_SHIPPING_ORIGIN_POSTAL_CODE),
// and then every buyer is told to pick another address until an operator
// notices.
func (b *Biteship) logRefusal(resp *http.Response) {
	if b.logger == nil {
		return
	}
	var body struct {
		Code int `json:"code"`
	}
	_ = json.NewDecoder(io.LimitReader(resp.Body, 4096)).Decode(&body) // the code is optional
	b.logger.Warn("biteship refused a rates request", "status", resp.StatusCode, "biteship_code", body.Code)
}

// requestBody is req as Biteship's JSON. Postal codes are numbers there.
func (b *Biteship) requestBody(req Request) ([]byte, error) {
	origin, err := strconv.Atoi(req.OriginPostalCode)
	if err != nil {
		return nil, fmt.Errorf("biteship: origin postal code %q: %w", req.OriginPostalCode, err)
	}
	destination, err := strconv.Atoi(req.DestinationPostalCode)
	if err != nil {
		return nil, fmt.Errorf("biteship: destination postal code %q: %w", req.DestinationPostalCode, err)
	}
	codes := make([]string, 0, len(Couriers))
	for _, c := range Couriers {
		codes = append(codes, string(c))
	}
	body, err := json.Marshal(biteshipRequest{
		OriginPostalCode: origin, DestinationPostalCode: destination,
		Couriers: strings.Join(codes, ","),
		Items:    []biteshipItem{{Name: "GoShop order", Value: req.Value, Weight: max(1, req.WeightGrams), Quantity: 1}},
	})
	if err != nil {
		return nil, fmt.Errorf("biteship: encode request: %w", err)
	}
	return body, nil
}

// mapBiteship keeps the services of GoShop's couriers with a usable price,
// as Quotes, cheapest first.
func mapBiteship(out biteshipResponse) []Quote {
	quotes := make([]Quote, 0, len(out.Pricing))
	for _, p := range out.Pricing {
		courier := Courier(strings.ToLower(p.CourierCode))
		if !courier.Valid() || p.Price <= 0 || p.CourierServiceCode == "" {
			continue
		}
		quotes = append(quotes, Quote{
			Courier: courier, CourierName: p.CourierName,
			Service: strings.ToUpper(p.CourierServiceCode), ServiceName: p.CourierServiceName,
			Price: p.Price, ETD: p.Duration,
		})
	}
	sortByPrice(quotes)
	return quotes
}
