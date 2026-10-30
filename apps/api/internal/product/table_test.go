package product

// Bab 12 artikel-02: the admin's product table, TableService and its
// helpers. The handler is tested in table_handler_test.go, the repository
// in table_repository_test.go.

import (
	"context"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

// fakeTableRepo records each TableQuery and answers from its fields.
type fakeTableRepo struct {
	queries []TableQuery
	rows    []TableRow
	total   int64
	err     error
}

func (f *fakeTableRepo) ListTable(_ context.Context, q TableQuery) ([]TableRow, int64, error) {
	f.queries = append(f.queries, q)
	return f.rows, f.total, f.err
}

func validTableParams() TableParams {
	return TableParams{Sort: TableSortUpdatedAt, Descending: true, Page: 1, PerPage: 20}
}

func TestTableService_List(t *testing.T) {
	repo := &fakeTableRepo{rows: []TableRow{{ID: "a"}, {ID: "b"}}, total: 42}
	params := TableParams{
		Query: "  Kaos  ", Status: StatusDraft, CategoryID: catIDForTable, LowStock: true,
		Sort: TableSortPriceFrom, Descending: false, Page: 3, PerPage: 20,
	}
	page, err := NewTableService(repo).List(context.Background(), params)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(repo.queries), 1)
	testx.AssertEqual(t, repo.queries[0], TableQuery{
		Search: "%Kaos%", Status: StatusDraft, CategoryID: catIDForTable, LowStock: true,
		Sort: TableSortPriceFrom, Descending: false, Offset: 40, Limit: 20,
	})
	testx.AssertEqual(t, len(page.Rows), 2)
	testx.AssertEqual(t, page.Rows[1].ID, "b")
	testx.AssertEqual(t, page.Page, 3)
	testx.AssertEqual(t, page.PerPage, 20)
	testx.AssertEqual(t, page.Total, int64(42))
}

const catIDForTable = "0190c8a0-0000-7000-8000-0000000000c1"

// Every sort the contract names reaches the repository unchanged.
func TestTableService_ListSorts(t *testing.T) {
	for _, sort := range []TableSort{TableSortName, TableSortPriceFrom, TableSortStock, TableSortUpdatedAt, TableSortCreatedAt} {
		t.Run(string(sort), func(t *testing.T) {
			repo := &fakeTableRepo{}
			params := validTableParams()
			params.Sort = sort
			_, err := NewTableService(repo).List(context.Background(), params)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, repo.queries[0].Sort, sort)
		})
	}
}

// The bounds: page 1 to MaxTablePage, per_page 1 to MaxTablePerPage. The
// last page and the largest page size give the largest offset the
// repository may cast to int32.
func TestTableService_ListBounds(t *testing.T) {
	tests := []struct {
		name       string
		page, per  int
		wantOffset int
	}{
		{name: "first page, smallest page size", page: 1, per: 1, wantOffset: 0},
		{name: "second page", page: 2, per: 1, wantOffset: 1},
		{name: "largest page and size", page: MaxTablePage, per: MaxTablePerPage, wantOffset: (MaxTablePage - 1) * MaxTablePerPage},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeTableRepo{}
			params := validTableParams()
			params.Page, params.PerPage = tt.page, tt.per
			_, err := NewTableService(repo).List(context.Background(), params)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, repo.queries[0].Offset, tt.wantOffset)
			testx.AssertEqual(t, repo.queries[0].Limit, tt.per)
		})
	}
}

// Invalid params never reach the repository.
func TestTableService_ListRefuses(t *testing.T) {
	tests := []struct {
		name    string
		change  func(*TableParams)
		wantErr string
	}{
		{name: "per_page 0", change: func(p *TableParams) { p.PerPage = 0 }, wantErr: "per_page 0 out of range"},
		{name: "per_page over the max", change: func(p *TableParams) { p.PerPage = MaxTablePerPage + 1 }, wantErr: "per_page 101 out of range"},
		{name: "page 0", change: func(p *TableParams) { p.Page = 0 }, wantErr: "page 0 out of range"},
		{name: "negative page", change: func(p *TableParams) { p.Page = -1 }, wantErr: "page -1 out of range"},
		{name: "page over the max", change: func(p *TableParams) { p.Page = MaxTablePage + 1 }, wantErr: "page 10001 out of range"},
		{name: "zero sort", change: func(p *TableParams) { p.Sort = "" }, wantErr: `unknown sort ""`},
		{name: "unknown sort", change: func(p *TableParams) { p.Sort = "sku" }, wantErr: `unknown sort "sku"`},
		{name: "sort with SQL", change: func(p *TableParams) { p.Sort = "name; DROP TABLE products" }, wantErr: "unknown sort"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := &fakeTableRepo{}
			params := validTableParams()
			tt.change(&params)
			page, err := NewTableService(repo).List(context.Background(), params)
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), "list product table: ")
			testx.AssertContains(t, err.Error(), tt.wantErr)
			testx.AssertEqual(t, len(repo.queries), 0, "the repository is not asked")
			testx.AssertEqual(t, len(page.Rows), 0)
		})
	}
}

func TestTableService_ListRepositoryError(t *testing.T) {
	boom := errors.New("connection refused")
	page, err := NewTableService(&fakeTableRepo{err: boom, total: 9}).List(context.Background(), validTableParams())
	testx.AssertTrue(t, errors.Is(err, boom), "wrapped: %v", err)
	testx.AssertContains(t, err.Error(), "list product table: connection refused")
	testx.AssertEqual(t, page.Total, int64(0), "no partial page on error")
}

// The search is trimmed and its ILIKE wildcards escaped, so "50%" and
// "KPH_M" match literally.
func TestTableService_ListSearchPattern(t *testing.T) {
	tests := []struct{ query, want string }{
		{query: "", want: ""},
		{query: "   ", want: ""},
		{query: "\tkaos\n", want: "%kaos%"},
		{query: "50%", want: `%50\%%`},
		{query: "KPH_M", want: `%KPH\_M%`},
		{query: `a\b`, want: `%a\\b%`},
		{query: `\%_`, want: `%\\\%\_%`},
	}
	for _, tt := range tests {
		t.Run(tt.query, func(t *testing.T) {
			repo := &fakeTableRepo{}
			params := validTableParams()
			params.Query = tt.query
			_, err := NewTableService(repo).List(context.Background(), params)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, repo.queries[0].Search, tt.want)
		})
	}
}

func TestLikePattern(t *testing.T) {
	testx.AssertEqual(t, likePattern(""), "")
	testx.AssertEqual(t, likePattern(" "), "% %", "trimming is the caller's")
	testx.AssertEqual(t, likePattern("kaos"), "%kaos%")
	testx.AssertEqual(t, likePattern("100%_"), `%100\%\_%`)
}

func TestTablePage_TotalPages(t *testing.T) {
	tests := []struct {
		total   int64
		perPage int
		want    int64
	}{
		{total: 0, perPage: 20, want: 0},
		{total: 1, perPage: 20, want: 1},
		{total: 20, perPage: 20, want: 1},
		{total: 21, perPage: 20, want: 2},
		{total: 100, perPage: 1, want: 100},
		{total: 5, perPage: 0, want: 0},  // never divides by zero
		{total: 5, perPage: -1, want: 0}, // nor by a negative size
	}
	for _, tt := range tests {
		got := TablePage{Total: tt.total, PerPage: tt.perPage}.TotalPages()
		testx.AssertEqual(t, got, tt.want, "total %d per page %d", tt.total, tt.perPage)
	}
}

func TestImage_Smallest(t *testing.T) {
	_, ok := Image{}.Smallest()
	testx.AssertFalse(t, ok, "no variant yet")

	v, ok := Image{Variants: []ImageVariant{{Width: 400, Key: "k400"}}}.Smallest()
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, v.Key, "k400")

	img := Image{Variants: []ImageVariant{{Width: 400, Key: "k400"}, {Width: 800, Key: "k800"}, {Width: 1600, Key: "k1600"}}}
	v, ok = img.Smallest()
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, v, ImageVariant{Width: 400, Key: "k400"})
	largest, _ := img.Largest()
	testx.AssertEqual(t, largest.Key, "k1600", "the opposite end of Largest")
}
