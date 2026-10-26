package report

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

var errBoom = errors.New("boom")

// day is a Jakarta date in the form Query takes it (midnight UTC).
func day(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }

func newService(t *testing.T, db *fakeSQL) *Service {
	t.Helper()
	return NewService(db.open(t))
}

func TestSales_Range(t *testing.T) {
	from := day(2025, 1, 1)
	tests := []struct {
		name     string
		from, to time.Time
		ok       bool
	}{
		{name: "one day", from: from, to: from, ok: true},
		{name: "to before from", from: from, to: from.AddDate(0, 0, -1)},
		{name: "a year before", from: from, to: from.AddDate(-1, 0, 0)},
		{name: "365 days apart (366 days inclusive)", from: from, to: from.AddDate(0, 0, MaxDays-1), ok: true},
		{name: "366 days apart", from: from, to: from.AddDate(0, 0, MaxDays)},
		{name: "two years", from: from, to: from.AddDate(2, 0, 0)},
		{name: "a whole leap year", from: day(2024, 1, 1), to: day(2024, 12, 31), ok: true},
		{name: "a leap year and a day", from: day(2024, 1, 1), to: day(2025, 1, 1)},
		// Only the date counts: a later time on the same day is not "after".
		{name: "same day, from later in the day", from: time.Date(2025, 3, 1, 23, 59, 0, 0, time.UTC), to: day(2025, 3, 1), ok: true},
		{name: "longest range, times ignored", from: time.Date(2025, 1, 1, 22, 0, 0, 0, time.UTC),
			to: time.Date(2026, 1, 1, 1, 0, 0, 0, time.UTC), ok: true},
	}
	testx.AssertEqual(t, MaxDays, 366)
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			db := newFakeSQL()
			_, err := newService(t, db).Sales(context.Background(), Query{From: tt.from, To: tt.to, Group: GroupDay})
			if tt.ok {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, len(db.names()), 2)
				return
			}
			testx.AssertTrue(t, errors.Is(err, ErrRange), "err %v", err)
			testx.AssertEqual(t, len(db.names()), 0, "no query runs for a refused range: %v", db.names())
		})
	}
}

func TestSales_QueryArguments(t *testing.T) {
	db := newFakeSQL()
	// Times of day and zones of the inputs do not matter, only their dates.
	q := Query{From: time.Date(2026, 10, 1, 15, 4, 5, 0, time.UTC), To: time.Date(2026, 10, 31, 20, 0, 0, 0, time.UTC), Group: GroupWeek}
	got, err := newService(t, db).Sales(context.Background(), q)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.Query, Query{From: day(2026, 10, 1), To: day(2026, 10, 31), Group: GroupWeek})

	testx.AssertEqual(t, len(db.names()), 2)
	testx.AssertEqual(t, db.names()[0], "SalesByPeriod")
	testx.AssertEqual(t, db.names()[1], "TopProducts")

	// The first day's midnight in Jakarta, and the midnight after the last.
	fromAt := time.Date(2026, 9, 30, 17, 0, 0, 0, time.UTC)
	toAt := time.Date(2026, 10, 31, 17, 0, 0, 0, time.UTC)

	sales, _ := db.call("SalesByPeriod")
	if len(sales.args) != 5 {
		t.Fatalf("SalesByPeriod args %v", sales.args)
	}
	testx.AssertEqual(t, sales.args[0], driver.Value("week"))
	assertTime(t, "from_at", sales.args[1], fromAt)
	assertTime(t, "to_at", sales.args[2], toAt)
	assertTime(t, "first_day", sales.args[3], day(2026, 10, 1))
	assertTime(t, "last_day", sales.args[4], day(2026, 10, 31))
	// The day arguments are midnight UTC: PostgreSQL's timestamp (without
	// time zone) takes their wall clock as is.
	testx.AssertEqual(t, sales.args[3].(time.Time).Location(), time.UTC)
	testx.AssertEqual(t, sales.args[4].(time.Time).Hour(), 0)
	_, offset := sales.args[1].(time.Time).Zone()
	testx.AssertEqual(t, offset, 7*60*60)

	top, _ := db.call("TopProducts")
	if len(top.args) != 3 {
		t.Fatalf("TopProducts args %v", top.args)
	}
	assertTime(t, "from_at", top.args[0], fromAt)
	assertTime(t, "to_at", top.args[1], toAt)
	testx.AssertEqual(t, top.args[2], driver.Value(int64(TopProducts)))
	testx.AssertEqual(t, TopProducts, 5)
}

// The report's rules live in its SQL. A sale is an order paid in the range
// that was not cancelled afterwards; the paid orders are summed per period
// inside the CTE, before the periods join them; and the products are
// ranked and cut to the top ones before their names are joined, so the
// join reads five product rows, not every product sold.
func TestSales_SQL(t *testing.T) {
	db := newFakeSQL()
	_, err := newService(t, db).Sales(context.Background(), Query{From: day(2026, 10, 1), To: day(2026, 10, 31), Group: GroupDay})
	testx.AssertNoError(t, err)

	sales := db.sqlOf("SalesByPeriod")
	for _, fragment := range []string{
		"o.status IN ('paid', 'processing', 'shipped', 'completed')",
		"o.paid_at >= $2::timestamptz AND o.paid_at < $3::timestamptz",
		"o.paid_at AT TIME ZONE 'Asia/Jakarta'",
		"GROUP BY 1 ), periods AS",
		"generate_series(",
		"LEFT JOIN paid ON paid.period = p.period",
		"OVER (ORDER BY p.period)",
	} {
		testx.AssertContains(t, sales, fragment)
	}

	top := db.sqlOf("TopProducts")
	for _, fragment := range []string{
		"o.status IN ('paid', 'processing', 'shipped', 'completed')",
		"o.paid_at >= $1::timestamptz AND o.paid_at < $2::timestamptz",
		"rank() OVER (ORDER BY s.revenue DESC)",
		"LIMIT $3 ) SELECT",
		"FROM ranked r JOIN products p ON p.id = r.product_id",
	} {
		testx.AssertContains(t, top, fragment)
	}
	// Ranked and cut before the join: the LIMIT comes before products.
	testx.AssertTrue(t, strings.Index(top, "LIMIT $3") < strings.Index(top, "JOIN products"), "%s", top)
}

func TestSales_RangeAcrossAYearEnd(t *testing.T) {
	db := newFakeSQL()
	_, err := newService(t, db).Sales(context.Background(), Query{From: day(2026, 12, 31), To: day(2026, 12, 31), Group: GroupMonth})
	testx.AssertNoError(t, err)
	sales, _ := db.call("SalesByPeriod")
	testx.AssertEqual(t, sales.args[0], driver.Value("month"))
	assertTime(t, "from_at", sales.args[1], time.Date(2026, 12, 30, 17, 0, 0, 0, time.UTC))
	assertTime(t, "to_at", sales.args[2], time.Date(2026, 12, 31, 17, 0, 0, 0, time.UTC))
}

func assertTime(t *testing.T, name string, got driver.Value, want time.Time) {
	t.Helper()
	tm, ok := got.(time.Time)
	if !ok {
		t.Fatalf("%s: %T %v is not a time", name, got, got)
	}
	testx.AssertTrue(t, tm.Equal(want), "%s = %s, want %s", name, tm, want)
}

func TestSales_Totals(t *testing.T) {
	db := newFakeSQL().
		on("SalesByPeriod", manyRows(
			[]driver.Value{day(2026, 10, 1), int64(100), int64(3), int64(100)},
			[]driver.Value{day(2026, 10, 2), int64(200), int64(3), int64(300)},
			[]driver.Value{day(2026, 10, 3), int64(0), int64(0), int64(300)},
			[]driver.Value{day(2026, 10, 4), int64(5), int64(2), int64(305)},
		)).
		on("TopProducts", manyRows(
			[]driver.Value{"p-1", "Kaos Polos", int64(4), int64(200), int64(1)},
			[]driver.Value{"p-2", "Topi", int64(2), int64(200), int64(1)},
			[]driver.Value{"p-3", "Tas", int64(1), int64(5), int64(3)},
		))
	got, err := newService(t, db).Sales(context.Background(), Query{From: day(2026, 10, 1), To: day(2026, 10, 4), Group: GroupDay})
	testx.AssertNoError(t, err)

	testx.AssertEqual(t, got.Revenue, int64(305))
	testx.AssertEqual(t, got.Orders, int64(8))
	testx.AssertEqual(t, got.AverageOrderValue, int64(38)) // 305/8 = 38.125

	want := []Period{
		{Start: day(2026, 10, 1), Revenue: 100, Orders: 3, AverageOrderValue: 33, CumulativeRevenue: 100}, // 33.33
		{Start: day(2026, 10, 2), Revenue: 200, Orders: 3, AverageOrderValue: 67, CumulativeRevenue: 300}, // 66.67
		{Start: day(2026, 10, 3), Revenue: 0, Orders: 0, AverageOrderValue: 0, CumulativeRevenue: 300},
		{Start: day(2026, 10, 4), Revenue: 5, Orders: 2, AverageOrderValue: 3, CumulativeRevenue: 305}, // 2.5
	}
	testx.AssertEqual(t, len(got.Series), len(want))
	for i := range want {
		testx.AssertEqual(t, got.Series[i], want[i], "period %d", i)
	}

	testx.AssertEqual(t, len(got.Top), 3)
	testx.AssertEqual(t, got.Top[0], Product{ID: "p-1", Name: "Kaos Polos", Units: 4, Revenue: 200, Rank: 1})
	testx.AssertEqual(t, got.Top[1], Product{ID: "p-2", Name: "Topi", Units: 2, Revenue: 200, Rank: 1})
	testx.AssertEqual(t, got.Top[2], Product{ID: "p-3", Name: "Tas", Units: 1, Revenue: 5, Rank: 3})
}

func TestSales_CumulativeRevenueIsTheDatabases(t *testing.T) {
	// The running total comes from SQL (a window function), not from a
	// sum in Go: an odd value passes through unchanged.
	db := newFakeSQL().on("SalesByPeriod", manyRows(
		[]driver.Value{day(2026, 10, 1), int64(10), int64(1), int64(999)},
	))
	got, err := newService(t, db).Sales(context.Background(), Query{From: day(2026, 10, 1), To: day(2026, 10, 1), Group: GroupDay})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.Series[0].CumulativeRevenue, int64(999))
	testx.AssertEqual(t, got.Revenue, int64(10))
}

func TestSales_Empty(t *testing.T) {
	db := newFakeSQL()
	got, err := newService(t, db).Sales(context.Background(), Query{From: day(2026, 10, 1), To: day(2026, 10, 7), Group: GroupDay})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, got.Revenue, int64(0))
	testx.AssertEqual(t, got.Orders, int64(0))
	testx.AssertEqual(t, got.AverageOrderValue, int64(0))
	testx.AssertEqual(t, len(got.Series), 0)
	testx.AssertEqual(t, len(got.Top), 0)
}

func TestSales_QueryErrors(t *testing.T) {
	q := Query{From: day(2026, 10, 1), To: day(2026, 10, 7), Group: GroupDay}

	db := newFakeSQL().on("SalesByPeriod", failWith(errBoom))
	_, err := newService(t, db).Sales(context.Background(), q)
	testx.AssertTrue(t, errors.Is(err, errBoom), "err %v", err)
	testx.AssertEqual(t, err.Error(), "sales by period: boom")
	_, ranTop := db.call("TopProducts")
	testx.AssertFalse(t, ranTop, "TopProducts runs after a failed series")

	db = newFakeSQL().on("TopProducts", failWith(errBoom))
	_, err = newService(t, db).Sales(context.Background(), q)
	testx.AssertTrue(t, errors.Is(err, errBoom), "err %v", err)
	testx.AssertEqual(t, err.Error(), "top products: boom")

	// A row that does not scan is an error too.
	db = newFakeSQL().on("SalesByPeriod", manyRows([]driver.Value{"not a time", int64(1), int64(1), int64(1)}))
	_, err = newService(t, db).Sales(context.Background(), q)
	testx.AssertError(t, err)
	testx.AssertContains(t, err.Error(), "sales by period: ")
}

func TestAverage(t *testing.T) {
	tests := []struct {
		revenue, orders, want int64
	}{
		{100, 3, 33}, // 33.33
		{200, 3, 67}, // 66.67
		{0, 0, 0},    // no orders
		{500, 0, 0},  // never divides by zero
		{5, 2, 3},    // 2.5: half away from zero
		{1, 2, 1},    // 0.5
		{3, 2, 2},    // 1.5
		{25, 10, 3},  // 2.5
		{117000, 1, 117000},
		{350000, 4, 87500},
		{1, 3, 0}, // 0.33
	}
	for _, tt := range tests {
		testx.AssertEqual(t, average(tt.revenue, tt.orders), tt.want, "%d/%d", tt.revenue, tt.orders)
	}
}

func TestToday_IsTheJakartaDate(t *testing.T) {
	tests := []struct {
		now  time.Time
		want time.Time
	}{
		{now: time.Date(2026, 10, 24, 18, 0, 0, 0, time.UTC), want: day(2026, 10, 25)},
		{now: time.Date(2026, 10, 24, 16, 59, 59, 0, time.UTC), want: day(2026, 10, 24)},
		{now: time.Date(2026, 10, 24, 17, 0, 0, 0, time.UTC), want: day(2026, 10, 25)},
		{now: time.Date(2026, 12, 31, 17, 30, 0, 0, time.UTC), want: day(2027, 1, 1)},
		// Another zone: 20:00 on the 24th in New York is 07:00 on the 25th in Jakarta.
		{now: time.Date(2026, 10, 24, 20, 0, 0, 0, time.FixedZone("EDT", -4*60*60)), want: day(2026, 10, 25)},
	}
	for _, tt := range tests {
		got := Today(tt.now)
		testx.AssertEqual(t, got, tt.want, "now %s", tt.now)
		testx.AssertEqual(t, got.Location(), time.UTC)
	}
}
