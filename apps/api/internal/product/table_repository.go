package product

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// ListTable returns the admin table's page q selects, with each product's
// thumbnail, and how many products match q's filters. It counts first: no
// match, or a page past the end, needs no second query. The two reads are
// not one snapshot, so a product saved between them can make Total off by
// one for that request; the next request is right again.
func (r *PostgresRepository) ListTable(ctx context.Context, q TableQuery) ([]TableRow, int64, error) {
	filters := sqlc.CountAdminProductsParams{
		LowStockThreshold: LowStockThreshold,
		Status:            nullString(q.Status),
		CategoryID:        optionalID(q.CategoryID),
		Search:            nullString(q.Search),
		LowStockOnly:      q.LowStock,
	}
	total, err := r.q.CountAdminProducts(ctx, filters)
	if err != nil {
		return nil, 0, fmt.Errorf("count products: %w", err)
	}
	if total == 0 || int64(q.Offset) >= total {
		return []TableRow{}, total, nil
	}

	rows, err := r.q.ListAdminProducts(ctx, sqlc.ListAdminProductsParams{
		LowStockThreshold: filters.LowStockThreshold, Status: filters.Status, CategoryID: filters.CategoryID,
		Search: filters.Search, LowStockOnly: filters.LowStockOnly,
		Sort: string(q.Sort), Descending: q.Descending,
		PageOffset: int32(q.Offset), // #nosec G115 -- the service caps it at MaxTablePage × MaxTablePerPage
		PageSize:   int32(q.Limit),  // #nosec G115 -- at most MaxTablePerPage
	})
	if err != nil {
		return nil, 0, fmt.Errorf("query products: %w", err)
	}
	out := make([]TableRow, 0, len(rows))
	ids := make([]string, 0, len(rows))
	for _, row := range rows {
		t := TableRow{
			ID: row.ID, Slug: row.Slug, Name: row.Name, Status: row.Status,
			CategoryID: row.CategoryID, CategoryName: row.CategoryName,
			Stock: row.Stock, VariantCount: row.VariantCount, LowStock: row.LowStock,
			CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
		}
		if row.PriceFrom.Valid {
			t.PriceFrom = &row.PriceFrom.Int64
		}
		out = append(out, t)
		ids = append(ids, row.ID)
	}
	if err := r.attachThumbnails(ctx, out, ids); err != nil {
		return nil, 0, err
	}
	return out, total, nil
}

// attachThumbnails sets each row's thumbnail from its first ready photo,
// with one query for the whole page.
func (r *PostgresRepository) attachThumbnails(ctx context.Context, rows []TableRow, ids []string) error {
	images, err := r.imagesOf(ctx, ids)
	if err != nil {
		return err
	}
	for i := range rows {
		for _, img := range images[rows[i].ID] {
			if smallest, ok := img.Smallest(); ok && img.Status == ImageReady {
				rows[i].Thumbnail = &smallest
				break
			}
		}
	}
	return nil
}

// nullString is s as a query parameter: NULL when it is empty.
func nullString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: s != ""}
}

// optionalID is id as a nullable uuid parameter: NULL when it is empty.
func optionalID(id string) *string {
	if id == "" {
		return nil
	}
	return &id
}
