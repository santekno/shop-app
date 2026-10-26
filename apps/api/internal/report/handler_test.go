package report

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// fakeReporter records the queries it is asked and answers sales or err.
type fakeReporter struct {
	mu      sync.Mutex
	queries []Query
	sales   Sales
	err     error
}

func (f *fakeReporter) Sales(_ context.Context, q Query) (Sales, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.queries = append(f.queries, q)
	if f.err != nil {
		return Sales{}, f.err
	}
	s := f.sales
	if s.Query == (Query{}) {
		s.Query = q
	}
	return s, nil
}

// handlerNow is 2026-10-25 01:00 in Jakarta (still the 24th in UTC).
var handlerNow = time.Date(2026, 10, 24, 18, 0, 0, 0, time.UTC)

func getSales(t *testing.T, rep Reporter, now func() time.Time, query string) *httptest.ResponseRecorder {
	t.Helper()
	r := chi.NewRouter()
	NewHandler(rep, httpapi.NewValidator(), now).AdminRoutes(r)
	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/reports/sales"+query, nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)
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

func fixedNow() time.Time { return handlerNow }

func TestHandler_Query(t *testing.T) {
	tests := []struct {
		name, query, from, to string
		group                 Group
	}{
		// Today in Jakarta is the 25th; the default is the 30 days ending today.
		{name: "default: last 30 days by day", query: "", from: "2026-09-26", to: "2026-10-25", group: GroupDay},
		{name: "from only", query: "?from=2026-10-01", from: "2026-10-01", to: "2026-10-25", group: GroupDay},
		{name: "to only: the 30 days ending then", query: "?to=2026-09-30", from: "2026-09-01", to: "2026-09-30", group: GroupDay},
		{name: "both, by month", query: "?from=2026-01-01&to=2026-06-30&group=month", from: "2026-01-01", to: "2026-06-30", group: GroupMonth},
		{name: "by week", query: "?group=week", from: "2026-09-26", to: "2026-10-25", group: GroupWeek},
		{name: "by day, explicit", query: "?group=day&from=2026-10-25&to=2026-10-25", from: "2026-10-25", to: "2026-10-25", group: GroupDay},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rep := &fakeReporter{}
			rec := getSales(t, rep, fixedNow, tt.query)
			testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
			testx.AssertEqual(t, len(rep.queries), 1)
			q := rep.queries[0]
			testx.AssertEqual(t, q.From.Format(time.DateOnly), tt.from)
			testx.AssertEqual(t, q.To.Format(time.DateOnly), tt.to)
			testx.AssertEqual(t, q.Group, tt.group)
		})
	}
}

func TestHandler_DefaultClockIsNow(t *testing.T) {
	rep := &fakeReporter{}
	before := Today(time.Now())
	rec := getSales(t, rep, nil, "")
	after := Today(time.Now())
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	to := rep.queries[0].To
	testx.AssertTrue(t, to.Equal(before) || to.Equal(after), "to %s, today %s", to, before)
	testx.AssertTrue(t, rep.queries[0].From.Equal(to.AddDate(0, 0, -29)), "from %s", rep.queries[0].From)
}

func TestHandler_InvalidQuery(t *testing.T) {
	tests := []struct {
		name, query, field string
	}{
		{name: "from not a date", query: "?from=2026-13-01", field: "from"},
		{name: "from in another format", query: "?from=01-10-2026", field: "from"},
		{name: "to with a time", query: "?to=2026-10-01T00:00:00Z", field: "to"},
		{name: "to not a date", query: "?to=yesterday", field: "to"},
		{name: "unknown group", query: "?group=year", field: "group"},
		{name: "empty group", query: "?group=", field: "group"},
		{name: "group case", query: "?group=Day", field: "group"},
		{name: "from twice", query: "?from=2026-10-01&from=2026-10-02", field: "from"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rep := &fakeReporter{}
			rec := getSales(t, rep, fixedNow, tt.query)
			b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
			_, ok := b.Error.Details[tt.field]
			testx.AssertTrue(t, ok, "details %v name %s", b.Error.Details, tt.field)
			testx.AssertEqual(t, len(rep.queries), 0, "the report ran for an invalid query")
		})
	}
}

func TestHandler_RangeError(t *testing.T) {
	rep := &fakeReporter{err: ErrRange}
	rec := getSales(t, rep, fixedNow, "?from=2026-10-25&to=2026-10-01")
	b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
	testx.AssertEqual(t, b.Error.Message, "invalid query parameters")
	testx.AssertEqual(t, b.Error.Details["to"], any("must be on or after from, at most 366 days in all, both included"))
	testx.AssertEqual(t, len(rep.queries), 1)

	// Wrapped, it is still a range error.
	rep = &fakeReporter{err: errors.Join(errors.New("ctx"), ErrRange)}
	rec = getSales(t, rep, fixedNow, "")
	assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
}

func TestHandler_ServiceRangeEndToEnd(t *testing.T) {
	// The real service refuses the range before any query.
	db := newFakeSQL()
	rec := getSales(t, NewService(db.open(t)), fixedNow, "?from=2025-01-01&to=2026-01-02")
	b := assertError(t, rec, http.StatusBadRequest, httpapi.CodeValidationFailed)
	testx.AssertContains(t, b.Error.Details["to"].(string), "366 days")
	testx.AssertEqual(t, len(db.names()), 0)
}

func TestHandler_OtherError(t *testing.T) {
	rep := &fakeReporter{err: errors.New("pq: relation orders_secret does not exist")}
	rec := getSales(t, rep, fixedNow, "")
	assertError(t, rec, http.StatusInternalServerError, httpapi.CodeInternal)
	testx.AssertFalse(t, strings.Contains(rec.Body.String(), "orders_secret"), "the cause reaches the client: %s", rec.Body.String())
}

// salesResponse is the JSON body, decoded with the handler's own money type.
type salesResponse struct {
	Data struct {
		From     string `json:"from"`
		To       string `json:"to"`
		Group    string `json:"group"`
		TimeZone string `json:"time_zone"`
		Totals   struct {
			Revenue           cart.MoneyJSON `json:"revenue"`
			OrderCount        int64          `json:"order_count"`
			AverageOrderValue cart.MoneyJSON `json:"average_order_value"`
		} `json:"totals"`
		Series []struct {
			Period            string         `json:"period"`
			Revenue           cart.MoneyJSON `json:"revenue"`
			OrderCount        int64          `json:"order_count"`
			AverageOrderValue cart.MoneyJSON `json:"average_order_value"`
			CumulativeRevenue cart.MoneyJSON `json:"cumulative_revenue"`
		} `json:"series"`
		TopProducts []struct {
			Rank      int32          `json:"rank"`
			ProductID string         `json:"product_id"`
			Name      string         `json:"name"`
			Units     int64          `json:"units"`
			Revenue   cart.MoneyJSON `json:"revenue"`
		} `json:"top_products"`
	} `json:"data"`
}

func TestHandler_JSON(t *testing.T) {
	rep := &fakeReporter{sales: Sales{
		Query:   Query{From: day(2026, 10, 5), To: day(2026, 10, 18), Group: GroupWeek},
		Revenue: 350000, Orders: 4, AverageOrderValue: 87500,
		Series: []Period{
			{Start: day(2026, 10, 5), Revenue: 100000, Orders: 1, AverageOrderValue: 100000, CumulativeRevenue: 100000},
			{Start: day(2026, 10, 12), Revenue: 250000, Orders: 3, AverageOrderValue: 83333, CumulativeRevenue: 350000},
		},
		Top: []Product{
			{ID: "0190a0a0-0000-7000-8000-000000000001", Name: "Kaos Polos", Units: 5, Revenue: 250000, Rank: 1},
			{ID: "0190a0a0-0000-7000-8000-000000000002", Name: "Topi", Units: 1, Revenue: 100000, Rank: 2},
		},
	}}
	rec := getSales(t, rep, fixedNow, "?from=2026-10-05&to=2026-10-18&group=week")
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertContains(t, rec.Header().Get("Content-Type"), "application/json")

	var b salesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &b); err != nil {
		t.Fatalf("decode %q: %v", rec.Body.String(), err)
	}
	d := b.Data
	testx.AssertEqual(t, d.From, "2026-10-05")
	testx.AssertEqual(t, d.To, "2026-10-18")
	testx.AssertEqual(t, d.Group, "week")
	testx.AssertEqual(t, d.TimeZone, "Asia/Jakarta")
	testx.AssertEqual(t, d.Totals.Revenue, cart.MoneyJSON{Amount: 350000, Currency: "IDR"})
	testx.AssertEqual(t, d.Totals.OrderCount, int64(4))
	testx.AssertEqual(t, d.Totals.AverageOrderValue, cart.MoneyJSON{Amount: 87500, Currency: "IDR"})

	testx.AssertEqual(t, len(d.Series), 2)
	testx.AssertEqual(t, d.Series[1].Period, "2026-10-12")
	testx.AssertEqual(t, d.Series[1].Revenue, cart.Rupiah(250000))
	testx.AssertEqual(t, d.Series[1].OrderCount, int64(3))
	testx.AssertEqual(t, d.Series[1].AverageOrderValue, cart.Rupiah(83333))
	testx.AssertEqual(t, d.Series[1].CumulativeRevenue, cart.Rupiah(350000))
	testx.AssertEqual(t, d.Series[0].Period, "2026-10-05")
	testx.AssertEqual(t, d.Series[0].CumulativeRevenue, cart.Rupiah(100000))

	testx.AssertEqual(t, len(d.TopProducts), 2)
	testx.AssertEqual(t, d.TopProducts[0].Rank, int32(1))
	testx.AssertEqual(t, d.TopProducts[0].ProductID, "0190a0a0-0000-7000-8000-000000000001")
	testx.AssertEqual(t, d.TopProducts[0].Name, "Kaos Polos")
	testx.AssertEqual(t, d.TopProducts[0].Units, int64(5))
	testx.AssertEqual(t, d.TopProducts[0].Revenue, cart.Rupiah(250000))
	testx.AssertEqual(t, d.TopProducts[1].Rank, int32(2))

	// Exactly these keys: the OpenAPI SalesReport.
	var raw map[string]map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	testx.AssertEqual(t, len(raw["data"]), 7, "data keys %v", raw["data"])
}

func TestHandler_EmptyReportHasEmptyArrays(t *testing.T) {
	rep := &fakeReporter{}
	rec := getSales(t, rep, fixedNow, "")
	testx.AssertEqual(t, rec.Code, http.StatusOK, "body %s", rec.Body.String())
	testx.AssertContains(t, rec.Body.String(), `"series":[]`)
	testx.AssertContains(t, rec.Body.String(), `"top_products":[]`)
	testx.AssertContains(t, rec.Body.String(), `"revenue":{"amount":0,"currency":"IDR"}`)
	testx.AssertContains(t, rec.Body.String(), `"order_count":0`)
}
