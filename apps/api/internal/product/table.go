package product

import (
	"context"
	"fmt"
	"strings"
	"time"
)

// The admin dashboard's product table (Bab 12): every product in any
// status, one numbered page at a time, filtered and sorted by column. It is
// a read model of its own, like the image flow, so the table can grow
// columns without touching the write rules in Service.

// TableSort is a column the admin's product table sorts by.
type TableSort string

// The sorts the contract allows. Stock is the sum over the sellable
// variants.
const (
	TableSortName      TableSort = "name"
	TableSortPriceFrom TableSort = "price_from"
	TableSortStock     TableSort = "stock"
	TableSortUpdatedAt TableSort = "updated_at"
	TableSortCreatedAt TableSort = "created_at"
)

// Table limits.
const (
	// LowStockThreshold: a sellable variant with this many units or fewer
	// is low on stock.
	LowStockThreshold = 5
	// MaxTablePerPage is the largest page.
	MaxTablePerPage = 100
	// MaxTablePage bounds the offset (page × per_page), so a request cannot
	// make PostgreSQL skip millions of rows.
	MaxTablePage = 10_000
)

// TableParams is one request for the admin's product table, already
// validated by the handler.
type TableParams struct {
	// Query is matched, case-insensitively and anywhere, against the
	// product's name and its variants' SKUs; empty (or only spaces) for no
	// search.
	Query string
	// Status is draft, active or archived; empty for every status.
	Status string
	// CategoryID keeps the products of this category and its children;
	// empty for every category.
	CategoryID string
	// LowStock keeps only products with a sellable variant at or below
	// LowStockThreshold.
	LowStock bool
	// Sort is the column; the zero value is not valid.
	Sort TableSort
	// Descending reverses the order. The id tie-break follows it.
	Descending bool
	// Page is 1 for the first page, up to MaxTablePage.
	Page int
	// PerPage is the page size, 1 to MaxTablePerPage.
	PerPage int
}

// TableRow is one product of the table.
type TableRow struct {
	ID           string
	Slug         string
	Name         string
	Status       string
	CategoryID   string
	CategoryName string
	// PriceFrom is nil while the product has no sellable variant.
	PriceFrom *int64
	// Stock is the units of all its sellable variants together.
	Stock        int64
	VariantCount int32
	// LowStock: some sellable variant is at or below LowStockThreshold.
	LowStock bool
	// Thumbnail is the narrowest copy of its first ready photo; nil when
	// no photo is ready yet.
	Thumbnail *ImageVariant
	CreatedAt time.Time
	UpdatedAt time.Time
}

// TablePage is one page of the table and where it sits in the whole.
type TablePage struct {
	Rows    []TableRow
	Page    int
	PerPage int
	// Total is how many products match the filters, on every page.
	Total int64
}

// TotalPages is how many pages the matching products fill; 0 when none
// match.
func (p TablePage) TotalPages() int64 {
	if p.PerPage < 1 {
		return 0
	}
	perPage := int64(p.PerPage)
	return (p.Total + perPage - 1) / perPage
}

// TableQuery is TableParams as the repository runs it.
type TableQuery struct {
	// Search is an ILIKE pattern, already escaped; empty for no search.
	Search     string
	Status     string
	CategoryID string
	LowStock   bool
	Sort       TableSort
	Descending bool
	Offset     int
	Limit      int
}

// TableRepository reads the table; *PostgresRepository is one.
type TableRepository interface {
	// ListTable returns the page of rows q selects and how many products
	// match its filters in all.
	ListTable(ctx context.Context, q TableQuery) ([]TableRow, int64, error)
}

// TableService serves the admin's product table.
type TableService struct {
	repo TableRepository
}

// NewTableService returns a TableService on repo.
func NewTableService(repo TableRepository) *TableService {
	return &TableService{repo: repo}
}

// List returns one page of the table. A page past the last one is empty,
// with the real Total, so the client can jump back.
func (s *TableService) List(ctx context.Context, params TableParams) (TablePage, error) {
	if params.PerPage < 1 || params.PerPage > MaxTablePerPage {
		return TablePage{}, fmt.Errorf("list product table: per_page %d out of range", params.PerPage)
	}
	if params.Page < 1 || params.Page > MaxTablePage {
		return TablePage{}, fmt.Errorf("list product table: page %d out of range", params.Page)
	}
	switch params.Sort {
	case TableSortName, TableSortPriceFrom, TableSortStock, TableSortUpdatedAt, TableSortCreatedAt:
	default:
		return TablePage{}, fmt.Errorf("list product table: unknown sort %q", params.Sort)
	}
	q := TableQuery{
		Search: likePattern(strings.TrimSpace(params.Query)), Status: params.Status, CategoryID: params.CategoryID,
		LowStock: params.LowStock, Sort: params.Sort, Descending: params.Descending,
		Offset: (params.Page - 1) * params.PerPage, Limit: params.PerPage,
	}
	rows, total, err := s.repo.ListTable(ctx, q)
	if err != nil {
		return TablePage{}, fmt.Errorf("list product table: %w", err)
	}
	return TablePage{Rows: rows, Page: params.Page, PerPage: params.PerPage, Total: total}, nil
}

// likeEscaper escapes ILIKE's wildcards, and its escape character itself,
// so a search for "50%" or "KPH_M" finds those characters literally.
var likeEscaper = strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)

// likePattern is a "contains text" ILIKE pattern; empty for no search.
func likePattern(text string) string {
	if text == "" {
		return ""
	}
	return "%" + likeEscaper.Replace(text) + "%"
}
