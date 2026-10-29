package product

// The SQL of PostgresRepository runs against PostgreSQL in
// tests/integration. Here: the pure parts it is built from.

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/santekno/sdk/testx"
)

func TestGroupProducts(t *testing.T) {
	created := time.Date(2026, 10, 1, 12, 0, 0, 0, time.UTC)
	updated := time.Date(2026, 10, 3, 2, 30, 0, 0, time.UTC)
	parent := "cat-pakaian"
	row := func(id, variantID string, stock int32) productRow {
		return productRow{
			ID: id, Slug: "slug-" + id, Name: "Name " + id, Description: "Desc " + id,
			PriceFrom: sql.NullInt64{Int64: 89000, Valid: true}, CreatedAt: created, UpdatedAt: updated,
			CategoryID: "cat-kaos", CategorySlug: "kaos", CategoryName: "Kaos", CategoryParentID: &parent,
			VariantID: variantID, VariantSku: "SKU-" + variantID, VariantName: "V " + variantID,
			VariantPrice: 89000, VariantStock: stock,
		}
	}

	testx.AssertEqual(t, len(groupProducts(nil)), 0, "no rows, no products")

	got := groupProducts([]productRow{
		row("b", "b1", 0), row("b", "b2", 3),
		row("a", "a1", 1),
		row("c", "c1", 0), row("c", "c2", 0), row("c", "c3", 2),
	})

	testx.AssertEqual(t, len(got), 3)
	if len(got) != 3 {
		return
	}
	// The order of the rows is the order of the products.
	testx.AssertEqual(t, got[0].ID, "b")
	testx.AssertEqual(t, got[1].ID, "a")
	testx.AssertEqual(t, got[2].ID, "c")
	testx.AssertEqual(t, len(got[0].Variants), 2)
	testx.AssertEqual(t, len(got[1].Variants), 1)
	testx.AssertEqual(t, len(got[2].Variants), 3)

	b := got[0]
	testx.AssertEqual(t, b.Slug, "slug-b")
	testx.AssertEqual(t, b.Name, "Name b")
	testx.AssertEqual(t, b.Description, "Desc b")
	testx.AssertEqual(t, b.PriceFrom, int64(89000))
	testx.AssertTrue(t, b.CreatedAt.Equal(created))
	testx.AssertTrue(t, b.UpdatedAt.Equal(updated), "UpdatedAt %v", b.UpdatedAt)
	testx.AssertEqual(t, b.Category.ID, "cat-kaos")
	testx.AssertEqual(t, b.Category.Slug, "kaos")
	testx.AssertEqual(t, b.Category.Name, "Kaos")
	testx.AssertTrue(t, b.Category.ParentID != nil && *b.Category.ParentID == parent)
	testx.AssertEqual(t, b.Variants[1], Variant{ID: "b2", SKU: "SKU-b2", Name: "V b2", Price: 89000, Stock: 3})
	testx.AssertEqual(t, got[2].Variants[2].ID, "c3")
}

// A product whose rows are not next to each other comes out twice: the
// queries must order by product, which tests/integration checks.
func TestGroupProducts_GroupsOnlyAdjacentRows(t *testing.T) {
	got := groupProducts([]productRow{{ID: "a", VariantID: "1"}, {ID: "b", VariantID: "2"}, {ID: "a", VariantID: "3"}})
	testx.AssertEqual(t, len(got), 3)
}

func TestWriteError(t *testing.T) {
	boom := errors.New("connection reset")
	tests := []struct {
		name      string
		err       error
		want      error  // matched with errors.Is
		wantExact bool   // the error is want itself
		wantText  string // the full message, when not exact
	}{
		{name: "nil stays nil", err: nil, want: nil, wantExact: true},
		{name: "duplicate slug", err: &pgconn.PgError{Code: "23505", ConstraintName: "products_slug_key"}, want: ErrSlugTaken, wantExact: true},
		{name: "duplicate SKU", err: &pgconn.PgError{Code: "23505", ConstraintName: "product_variants_sku_key"}, want: ErrSKUTaken, wantExact: true},
		{name: "unknown category", err: &pgconn.PgError{Code: "23503", ConstraintName: "products_category_fkey"}, want: ErrUnknownCategory, wantExact: true},
		{
			name: "matched through wrapping",
			err:  errors.Join(errors.New("exec"), &pgconn.PgError{ConstraintName: "products_slug_key"}),
			want: ErrSlugTaken, wantExact: true,
		},
		{
			// Invalid UTF-8 or NUL that got past the handler: a 400, not a 500.
			name: "invalid text (22021)", err: &pgconn.PgError{Code: "22021", Message: "invalid byte sequence for encoding \"UTF8\": 0x00"},
			want: ErrInvalidText, wantExact: true,
		},
		{
			name: "invalid text wins over a constraint name", err: &pgconn.PgError{Code: "22021", ConstraintName: "products_slug_key"},
			want: ErrInvalidText, wantExact: true,
		},
		{
			name:     "another constraint is wrapped with the action",
			err:      &pgconn.PgError{Code: "23514", Severity: "ERROR", ConstraintName: "product_variants_price_check", Message: "check violated"},
			wantText: "insert variant KPH-S: ERROR: check violated (SQLSTATE 23514)",
		},
		{name: "any other error is wrapped", err: boom, want: boom, wantText: "insert variant KPH-S: connection reset"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := writeError("insert variant KPH-S", tt.err)
			if tt.wantExact {
				testx.AssertEqual(t, got, tt.want)
				return
			}
			if tt.want != nil {
				testx.AssertTrue(t, errors.Is(got, tt.want), "err = %v", got)
			}
			if got == nil {
				t.Fatal("writeError: got nil")
			}
			testx.AssertEqual(t, got.Error(), tt.wantText)
			for _, sentinel := range []error{ErrSlugTaken, ErrSKUTaken, ErrUnknownCategory, ErrInvalidText} {
				testx.AssertFalse(t, errors.Is(got, sentinel), "%v must not become %v", got, sentinel)
			}
		})
	}
}

func TestListQuery_Search(t *testing.T) {
	testx.AssertEqual(t, ListQuery{}.search(), sql.NullString{}, "no search is NULL, not ''")
	testx.AssertEqual(t, ListQuery{Search: "kaos"}.search(), sql.NullString{String: "kaos", Valid: true})
}

func TestPostgresRepository_List_UnknownSort(t *testing.T) {
	// The sort picks the query; an unknown one fails before any SQL runs,
	// which is why a nil pool is enough here.
	r := NewPostgresRepository(nil)
	got, err := r.List(context.Background(), ListQuery{Sort: "popular", Limit: 21})
	if err == nil {
		t.Fatal("List: want error, got nil")
	}
	testx.AssertEqual(t, err.Error(), `query products: unknown sort "popular"`)
	testx.AssertTrue(t, got == nil)
}
