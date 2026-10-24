//go:build integration

package integration_test

import (
	"encoding/json"
	"math"
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/user"
)

// salesOut is SalesReport.
type salesOut struct {
	From     string `json:"from"`
	To       string `json:"to"`
	Group    string `json:"group"`
	TimeZone string `json:"time_zone"`
	Totals   struct {
		Revenue           moneyOut `json:"revenue"`
		OrderCount        int64    `json:"order_count"`
		AverageOrderValue moneyOut `json:"average_order_value"`
	} `json:"totals"`
	Series []struct {
		Period            string   `json:"period"`
		Revenue           moneyOut `json:"revenue"`
		OrderCount        int64    `json:"order_count"`
		AverageOrderValue moneyOut `json:"average_order_value"`
		CumulativeRevenue moneyOut `json:"cumulative_revenue"`
	} `json:"series"`
	TopProducts []struct {
		Rank      int      `json:"rank"`
		ProductID string   `json:"product_id"`
		Name      string   `json:"name"`
		Units     int64    `json:"units"`
		Revenue   moneyOut `json:"revenue"`
	} `json:"top_products"`
}

// assertSales checks a 200 SalesReportDetail against the contract.
func assertSales(t *testing.T, resp response, what string) salesOut {
	t.Helper()
	if resp.Status != http.StatusOK {
		t.Fatalf("%s = %s, want 200", what, describe(resp))
	}
	assertJSONContentType(t, resp.Header, what)
	top := object(t, resp.Body, "SalesReportDetail", what)
	data := object(t, top["data"], "SalesReport", what+" data")
	totals := decodeObject(t, data["totals"])
	assertKeys(t, totals, []string{"revenue", "order_count", "average_order_value"}, what+".totals")
	for _, k := range []string{"revenue", "average_order_value"} {
		assertMoney(t, totals[k], what+".totals."+k)
	}
	for i, raw := range array(t, data["series"], what+".series") {
		w := what + ".series[" + strconv.Itoa(i) + "]"
		p := decodeObject(t, raw)
		assertKeys(t, p, []string{"period", "revenue", "order_count", "average_order_value", "cumulative_revenue"}, w)
		for _, k := range []string{"revenue", "average_order_value", "cumulative_revenue"} {
			assertMoney(t, p[k], w+"."+k)
		}
	}
	for i, raw := range array(t, data["top_products"], what+".top_products") {
		w := what + ".top_products[" + strconv.Itoa(i) + "]"
		p := decodeObject(t, raw)
		assertKeys(t, p, []string{"rank", "product_id", "name", "units", "revenue"}, w)
		assertMoney(t, p["revenue"], w+".revenue")
	}
	var s salesOut
	if err := json.Unmarshal(top["data"], &s); err != nil {
		t.Fatal(err)
	}
	if s.TimeZone != "Asia/Jakarta" || len(s.TopProducts) > 5 {
		t.Errorf("%s: time_zone %q with %d top products", what, s.TimeZone, len(s.TopProducts))
	}
	for _, p := range s.Series {
		if _, err := time.Parse(time.DateOnly, p.Period); err != nil {
			t.Errorf("%s: period %q is not a date", what, p.Period)
		}
	}
	return s
}

// rounded is a / b rounded half away from zero, as the report rounds.
func rounded(a, b int64) int64 { return int64(math.Round(float64(a) / float64(b))) }

// TestSalesReport_MatchesThePaidOrders seeds orders paid on known Jakarta
// days around midnight, one shipped, one paid and then cancelled, one
// unpaid and one before the range, and checks every number of the report
// by day, week and month against them.
func TestSalesReport_MatchesThePaidOrders(t *testing.T) {
	sh := newShop(t, nil)
	x := sh.product(t, "kaos-laris", variant("LR-M", "M", 50000, 100))
	y := sh.product(t, "kaos-sedang", variant("SD-M", "M", 30000, 100))
	z := sh.product(t, "kaos-murah", variant("MR-M", "M", 20000, 100))
	b := sh.buyer(t, "laporan")
	b2 := sh.buyer(t, "laporan-2")
	paidAt := func(o orderOut, at string) {
		t.Helper()
		sh.markPaid(t, o.ID)
		mustExec(t, sh.db, `UPDATE orders SET paid_at = $2 WHERE id = $1`, o.ID, at)
	}

	a := sh.order(t, b, line{x.Variants["LR-M"], 2})
	paidAt(a, "2026-09-30T17:30:00Z") // 1 October, 00:30 WIB
	bb := sh.order(t, b, line{y.Variants["SD-M"], 1}, line{x.Variants["LR-M"], 1})
	paidAt(bb, "2026-10-01T16:30:00Z") // 1 October, 23:30 WIB
	c := sh.order(t, b, line{z.Variants["MR-M"], 3})
	paidAt(c, "2026-10-01T17:30:00Z") // 2 October, 00:30 WIB
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+c.ID+"/process", nil), http.StatusOK, "process")
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+c.ID+"/ship",
		map[string]string{"tracking_number": "SCP-1122334455"}), http.StatusOK, "ship")
	before := sh.order(t, b, line{x.Variants["LR-M"], 5})
	paidAt(before, "2026-09-27T16:59:00Z") // 27 September, 23:59 WIB: before the range
	refunded := sh.order(t, b2, line{y.Variants["SD-M"], 4})
	paidAt(refunded, "2026-10-03T03:00:00Z")
	assertOrderDetail(t, sh.staffCall(t, http.MethodPost, "/v1/admin/orders/"+refunded.ID+"/cancel", nil), http.StatusOK, "seller cancel")
	sh.order(t, b2, line{z.Variants["MR-M"], 1}) // never paid

	ta, tb, tc := a.Totals.Total.Amount, bb.Totals.Total.Amount, c.Totals.Total.Amount
	revenue := ta + tb + tc

	daily := assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?from=2026-09-28&to=2026-10-04&group=day", nil), "daily")
	if daily.From != "2026-09-28" || daily.To != "2026-10-04" || daily.Group != "day" || len(daily.Series) != 7 {
		t.Fatalf("daily report %s..%s by %s with %d periods, want 7 days", daily.From, daily.To, daily.Group, len(daily.Series))
	}
	if daily.Totals.Revenue.Amount != revenue || daily.Totals.OrderCount != 3 || daily.Totals.AverageOrderValue.Amount != rounded(revenue, 3) {
		t.Errorf("totals %+v, want revenue %d over 3 orders", daily.Totals, revenue)
	}
	wantDay := map[string][2]int64{"2026-10-01": {ta + tb, 2}, "2026-10-02": {tc, 1}}
	var running int64
	for i, p := range daily.Series {
		if want := time.Date(2026, 9, 28+i, 0, 0, 0, 0, time.UTC).Format(time.DateOnly); p.Period != want {
			t.Errorf("period %d is %s, want %s", i, p.Period, want)
		}
		w := wantDay[p.Period]
		running += w[0]
		aov := int64(0)
		if w[1] > 0 {
			aov = rounded(w[0], w[1])
		}
		if p.Revenue.Amount != w[0] || p.OrderCount != w[1] || p.AverageOrderValue.Amount != aov || p.CumulativeRevenue.Amount != running {
			t.Errorf("%s: %+v, want revenue %d, %d orders, AOV %d, running %d", p.Period, p, w[0], w[1], aov, running)
		}
	}
	type top struct {
		id    string
		units int64
		rev   int64
	}
	wantTop := []top{{x.ID, 3, 150000}, {z.ID, 3, 60000}, {y.ID, 1, 30000}}
	if len(daily.TopProducts) != len(wantTop) {
		t.Fatalf("top products %+v, want %d", daily.TopProducts, len(wantTop))
	}
	for i, w := range wantTop {
		got := daily.TopProducts[i]
		if got.Rank != i+1 || got.ProductID != w.id || got.Units != w.units || got.Revenue.Amount != w.rev || got.Name == "" {
			t.Errorf("top product %d = %+v, want %+v", i+1, got, w)
		}
	}

	weekly := assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?from=2026-09-28&to=2026-10-04&group=week", nil), "weekly")
	if len(weekly.Series) != 1 || weekly.Series[0].Period != "2026-09-28" || weekly.Series[0].Revenue.Amount != revenue ||
		weekly.Series[0].OrderCount != 3 {
		t.Errorf("weekly series %+v, want one week from Monday 28 September", weekly.Series)
	}
	monthly := assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?from=2026-09-28&to=2026-10-04&group=month", nil), "monthly")
	if len(monthly.Series) != 2 || monthly.Series[0].Period != "2026-09-01" || monthly.Series[0].Revenue.Amount != 0 ||
		monthly.Series[1].Period != "2026-10-01" || monthly.Series[1].Revenue.Amount != revenue || monthly.Series[1].CumulativeRevenue.Amount != revenue {
		t.Errorf("monthly series %+v, want an empty September (from the 28th) and October", monthly.Series)
	}
	// The order paid on the 27th counts once the range reaches it.
	wider := assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?from=2026-09-27&to=2026-10-04", nil), "from the 27th")
	if wider.Totals.OrderCount != 4 || wider.Totals.Revenue.Amount != revenue+before.Totals.Total.Amount || len(wider.Series) != 8 {
		t.Errorf("from the 27th: %+v over %d days", wider.Totals, len(wider.Series))
	}
	assertNoServerErrors(t, sh.server)
}

// TestSalesReport_QueryAndAccess: the default range is the 30 days up to
// today in Jakarta; a reversed range, one over 366 days, an unknown group
// or a date that is not a date is 400; only staff may read it.
func TestSalesReport_QueryAndAccess(t *testing.T) {
	sh := newShop(t, nil)
	def := assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales", nil), "default")
	today := time.Now().In(time.FixedZone("WIB", 7*3600)).Format(time.DateOnly)
	if def.To != today || def.Group != "day" || len(def.Series) != 30 || def.Totals.OrderCount != 0 || len(def.TopProducts) != 0 {
		t.Errorf("default report %s..%s by %s, %d periods; want the 30 days up to %s", def.From, def.To, def.Group, len(def.Series), today)
	}
	for _, q := range []string{
		"from=2026-10-05&to=2026-10-04", "from=2025-01-01&to=2026-01-02", "group=year", "from=2026-13-01",
		"to=kemarin",
	} {
		resp := sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?"+q, nil)
		if resp.Status != http.StatusBadRequest {
			t.Errorf("?%s = %s, want 400", q, describe(resp))
			continue
		}
		assertError(t, resp, http.StatusBadRequest, "VALIDATION_FAILED")
	}
	assertSales(t, sh.staffCall(t, http.MethodGet, "/v1/admin/reports/sales?from=2025-10-05&to=2026-10-05", nil), "366 days")

	b := sh.buyer(t, "bukan-penjual")
	assertError(t, sh.call(t, http.MethodGet, "/v1/admin/reports/sales", nil, b.Token), http.StatusForbidden, "FORBIDDEN")
	assertError(t, sh.call(t, http.MethodGet, "/v1/admin/reports/sales", nil, ""), http.StatusUnauthorized, "UNAUTHORIZED")
	seller := sh.accountWithRole(t, user.RoleSeller)
	assertSales(t, sh.call(t, http.MethodGet, "/v1/admin/reports/sales", nil, seller.AccessToken), "as a seller")
}
