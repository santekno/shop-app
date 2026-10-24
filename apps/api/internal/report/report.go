// Package report is the seller's sales report (ADR 0007): revenue, order
// count and average order value per day, week or month, and the top
// products, straight from SQL (a CTE, generate_series and window
// functions) on the orders that count as sales.
package report

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/moneyx"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Group is a report's period.
type Group string

// The periods; weeks start on Monday.
const (
	GroupDay   Group = "day"
	GroupWeek  Group = "week"
	GroupMonth Group = "month"
)

// Limits of one report.
const (
	// MaxDays is the longest range.
	MaxDays = 366
	// TopProducts is how many products the report ranks.
	TopProducts = 5
)

// ErrRange means to is before from, or the range is longer than MaxDays.
var ErrRange = errors.New("invalid report range")

// wib is Western Indonesia Time: the report's days.
var wib = time.FixedZone("WIB", 7*60*60)

// Query is one report request: Jakarta dates, both included.
type Query struct {
	From  time.Time // a date; only year, month and day count
	To    time.Time
	Group Group
}

// Period is one row of the series.
type Period struct {
	// Start is the period's first day (Jakarta).
	Start             time.Time
	Revenue           int64
	Orders            int64
	AverageOrderValue int64
	// CumulativeRevenue is the revenue from the range's start to this
	// period's end.
	CumulativeRevenue int64
}

// Product is one of the top products.
type Product struct {
	ID      string
	Name    string
	Units   int64
	Revenue int64
	Rank    int32
}

// Sales is the report.
type Sales struct {
	Query             Query
	Revenue           int64
	Orders            int64
	AverageOrderValue int64
	Series            []Period
	Top               []Product
}

// Service builds reports from the database.
type Service struct {
	q *sqlc.Queries
}

// NewService returns a Service on db.
func NewService(db *sql.DB) *Service { return &Service{q: sqlc.New(db)} }

// Sales is the sales report for q. Errors: ErrRange.
func (s *Service) Sales(ctx context.Context, q Query) (Sales, error) {
	first, last := date(q.From), date(q.To)
	if last.Before(first) || last.Sub(first) >= MaxDays*24*time.Hour {
		return Sales{}, ErrRange
	}
	// The range in absolute time: from the first day's midnight in Jakarta
	// to the midnight after the last day.
	fromAt := time.Date(first.Year(), first.Month(), first.Day(), 0, 0, 0, 0, wib)
	toAt := time.Date(last.Year(), last.Month(), last.Day(), 0, 0, 0, 0, wib).AddDate(0, 0, 1)

	rows, err := s.q.SalesByPeriod(ctx, sqlc.SalesByPeriodParams{
		Unit: string(q.Group), FromAt: fromAt, ToAt: toAt, FirstDay: first, LastDay: last,
	})
	if err != nil {
		return Sales{}, fmt.Errorf("sales by period: %w", err)
	}
	top, err := s.q.TopProducts(ctx, sqlc.TopProductsParams{FromAt: fromAt, ToAt: toAt, Top: TopProducts})
	if err != nil {
		return Sales{}, fmt.Errorf("top products: %w", err)
	}

	out := Sales{Query: Query{From: first, To: last, Group: q.Group}}
	for _, r := range rows {
		out.Series = append(out.Series, Period{
			Start: r.Period, Revenue: r.Revenue, Orders: r.Orders,
			AverageOrderValue: average(r.Revenue, r.Orders), CumulativeRevenue: r.CumulativeRevenue,
		})
		out.Revenue += r.Revenue
		out.Orders += r.Orders
	}
	out.AverageOrderValue = average(out.Revenue, out.Orders)
	for _, r := range top {
		out.Top = append(out.Top, Product{ID: r.ProductID, Name: r.Name, Units: r.Units, Revenue: r.Revenue, Rank: r.Rank})
	}
	return out, nil
}

// average is revenue / orders in whole rupiah, rounded half away from
// zero (sdk moneyx, exact), and 0 without orders.
func average(revenue, orders int64) int64 {
	if orders == 0 {
		return 0
	}
	return moneyx.FromInt(revenue).Div(moneyx.FromInt(orders)).RoundIDR()
}

// date is t's calendar date as midnight UTC: the form PostgreSQL's
// timestamp (without time zone) parameters take a Jakarta date in.
func date(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

// Today is now's date in Jakarta.
func Today(now time.Time) time.Time { return date(now.In(wib)) }
