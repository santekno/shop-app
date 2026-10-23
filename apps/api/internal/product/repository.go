package product

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/category"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores products in PostgreSQL with the queries sqlc
// generated from internal/db/queries/products.sql.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's connection
// pool (or any database a test opens).
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// ListQuery selects one page of the storefront list.
type ListQuery struct {
	// CategoryIDs limits the page to these categories (a category and its
	// children); nil for every category.
	CategoryIDs []string
	// Search is the text to search for; empty for no search.
	Search string
	// Sort picks the order, and so which of the three queries runs.
	Sort Sort
	// After is where the page starts: just after this position.
	After position
	// Limit is the most products to return.
	Limit int
}

// search is q.Search as the query parameter: NULL when there is none.
func (q ListQuery) search() sql.NullString {
	return sql.NullString{String: q.Search, Valid: q.Search != ""}
}

// List returns up to q.Limit active products after q.After in q.Sort order,
// each with its sellable variants.
func (r *PostgresRepository) List(ctx context.Context, q ListQuery) ([]Product, error) {
	limit := int32(q.Limit) // #nosec G115 -- the service caps Limit at 101
	var page []productRow
	switch q.Sort {
	case SortNewest:
		rows, err := r.q.ListProductsNewest(ctx, sqlc.ListProductsNewestParams{
			CategoryIds: q.CategoryIDs, Search: q.search(), CursorCreatedAt: q.After.CreatedAt, CursorID: q.After.ID, PageSize: limit,
		})
		if err != nil {
			return nil, fmt.Errorf("query products: %w", err)
		}
		page = rows
	case SortPriceAsc:
		rows, err := r.q.ListProductsPriceAsc(ctx, sqlc.ListProductsPriceAscParams{
			CategoryIds: q.CategoryIDs, Search: q.search(), CursorPrice: q.After.Price, CursorID: q.After.ID, PageSize: limit,
		})
		if err != nil {
			return nil, fmt.Errorf("query products: %w", err)
		}
		// The three list queries return the same columns, so their
		// generated row types convert into one another.
		for _, row := range rows {
			page = append(page, productRow(row))
		}
	case SortPriceDesc:
		rows, err := r.q.ListProductsPriceDesc(ctx, sqlc.ListProductsPriceDescParams{
			CategoryIds: q.CategoryIDs, Search: q.search(), CursorPrice: q.After.Price, CursorID: q.After.ID, PageSize: limit,
		})
		if err != nil {
			return nil, fmt.Errorf("query products: %w", err)
		}
		for _, row := range rows {
			page = append(page, productRow(row))
		}
	default:
		return nil, fmt.Errorf("query products: unknown sort %q", q.Sort)
	}
	return groupProducts(page), nil
}

// GetBySlug returns the active product with slug, or ErrNotFound.
func (r *PostgresRepository) GetBySlug(ctx context.Context, slug string) (Product, error) {
	rows, err := r.q.GetActiveProductBySlug(ctx, slug)
	if err != nil {
		return Product{}, fmt.Errorf("query product: %w", err)
	}
	// The generated row types of the two reads have the same fields, so
	// Go converts one into the other.
	page := make([]productRow, len(rows))
	for i, row := range rows {
		page[i] = productRow(row)
	}
	products := groupProducts(page)
	if len(products) == 0 {
		return Product{}, ErrNotFound
	}
	return products[0], nil
}

// productRow is one row of the storefront reads: a product, its category
// and one of its sellable variants.
type productRow = sqlc.ListProductsNewestRow

// groupProducts folds rows, which arrive ordered by product, into products
// with their variants, keeping the order.
func groupProducts(rows []productRow) []Product {
	var products []Product
	for _, row := range rows {
		if len(products) == 0 || products[len(products)-1].ID != row.ID {
			products = append(products, Product{
				ID:          row.ID,
				Slug:        row.Slug,
				Name:        row.Name,
				Description: row.Description,
				Category: category.Category{
					ID:       row.CategoryID,
					Slug:     row.CategorySlug,
					Name:     row.CategoryName,
					ParentID: row.CategoryParentID,
				},
				PriceFrom: row.PriceFrom.Int64, // never NULL for an active product
				CreatedAt: row.CreatedAt,
			})
		}
		last := &products[len(products)-1]
		last.Variants = append(last.Variants, Variant{
			ID:    row.VariantID,
			SKU:   row.VariantSku,
			Name:  row.VariantName,
			Price: row.VariantPrice,
			Stock: row.VariantStock,
		})
	}
	return products
}

// GetAdmin returns the product with id, whatever its status, with its
// sellable variants, or ErrNotFound.
func (r *PostgresRepository) GetAdmin(ctx context.Context, id string) (AdminProduct, error) {
	row, err := r.q.GetProduct(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return AdminProduct{}, ErrNotFound
	}
	if err != nil {
		return AdminProduct{}, fmt.Errorf("query product: %w", err)
	}
	variants, err := r.q.ListSellableVariants(ctx, id)
	if err != nil {
		return AdminProduct{}, fmt.Errorf("query variants: %w", err)
	}

	p := AdminProduct{
		ID:          row.ID,
		CategoryID:  row.CategoryID,
		Slug:        row.Slug,
		Name:        row.Name,
		Description: row.Description,
		Status:      row.Status,
		CreatedAt:   row.CreatedAt,
		UpdatedAt:   row.UpdatedAt,
		Variants:    make([]AdminVariant, 0, len(variants)),
	}
	if row.PriceFrom.Valid {
		p.PriceFrom = &row.PriceFrom.Int64
	}
	for _, v := range variants {
		p.Variants = append(p.Variants, AdminVariant{
			ID: v.ID, SKU: v.Sku, Name: v.Name, Price: v.Price, Stock: v.Stock, WeightGrams: v.WeightGrams,
			Version: v.Version,
		})
	}
	return p, nil
}

// Create stores a new product with its variants in one transaction and
// returns its ID. Either all of it is stored or none of it.
func (r *PostgresRepository) Create(ctx context.Context, in Input) (string, error) {
	id := uuidx.NewV7()
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		err := q.InsertProduct(ctx, sqlc.InsertProductParams{
			ID: id, CategoryID: in.CategoryID, Slug: in.Slug, Name: in.Name, Description: in.Description,
		})
		if err != nil {
			return writeError("insert product", err)
		}
		for i, v := range in.Variants {
			if err := insertVariant(ctx, q, id, i, v); err != nil {
				return err
			}
		}
		return updateProduct(ctx, q, id, in)
	})
	if err != nil {
		return "", err
	}
	return id, nil
}

// Update saves the product with id and its variants in one transaction: a
// variant with an ID is updated if its Version is still current, one
// without is added, and a sellable variant missing from in.Variants is
// archived. It returns ErrNotFound for an unknown product,
// ErrUnknownVariant for a variant ID that is not a sellable variant of it,
// and a *VersionConflictError when a variant changed since it was read.
func (r *PostgresRepository) Update(ctx context.Context, id string, in Input) error {
	return database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if _, err := q.LockProduct(ctx, id); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock product: %w", err)
		}
		// Then all its variants, in id order, before writing any of them
		// in the form's order (ADR 0006, "Lock order").
		if err := q.LockProductVariants(ctx, id); err != nil {
			return fmt.Errorf("lock variants: %w", err)
		}
		if err := archiveMissingVariants(ctx, q, id, in.Variants); err != nil {
			return err
		}
		for i, v := range in.Variants {
			var err error
			if v.ID == "" {
				err = insertVariant(ctx, q, id, i, v)
			} else {
				err = updateVariant(ctx, q, id, i, v)
			}
			if err != nil {
				return err
			}
		}
		return updateProduct(ctx, q, id, in)
	})
}

// Archive takes the product with id off the storefront (status archived).
// Its variants keep their state, so restoring it is a status change.
func (r *PostgresRepository) Archive(ctx context.Context, id string) error {
	n, err := r.q.ArchiveProduct(ctx, id)
	if err != nil {
		return fmt.Errorf("archive product: %w", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// archiveMissingVariants archives, in one statement, every sellable variant
// of the product that keep does not list by ID. keep always has at least one
// variant, so the product never ends up without a sellable one.
func archiveMissingVariants(ctx context.Context, q *sqlc.Queries, productID string, keep []VariantInput) error {
	// Not nil: an empty array keeps nothing, but NULL would make
	// "id <> ALL(NULL)" unknown and archive nothing.
	keepIDs := make([]string, 0, len(keep))
	for _, v := range keep {
		if v.ID != "" {
			keepIDs = append(keepIDs, v.ID)
		}
	}
	err := q.ArchiveVariantsNotIn(ctx, sqlc.ArchiveVariantsNotInParams{ProductID: productID, KeepIds: keepIDs})
	if err != nil {
		return fmt.Errorf("archive variants: %w", err)
	}
	return nil
}

// insertVariant and updateVariant store v at position, its index in the
// admin's list, which orders variants with the same price.
func insertVariant(ctx context.Context, q *sqlc.Queries, productID string, position int, v VariantInput) error {
	err := q.InsertVariant(ctx, sqlc.InsertVariantParams{
		ID: uuidx.NewV7(), ProductID: productID, Position: int16(position), // #nosec G115 -- at most 50 variants
		Sku: v.SKU, Name: v.Name, Price: v.Price, Stock: v.Stock, WeightGrams: v.WeightGrams,
	})
	return writeError("insert variant "+v.SKU, err)
}

func updateVariant(ctx context.Context, q *sqlc.Queries, productID string, position int, v VariantInput) error {
	n, err := q.UpdateVariant(ctx, sqlc.UpdateVariantParams{
		ID: v.ID, ProductID: productID, Position: int16(position), // #nosec G115 -- at most 50 variants
		Sku: v.SKU, Name: v.Name, Price: v.Price, Stock: v.Stock, WeightGrams: v.WeightGrams,
		Version: v.Version,
	})
	if err != nil {
		return writeError("update variant "+v.SKU, err)
	}
	if n == 1 {
		return nil
	}
	_, err = q.GetVariantVersion(ctx, sqlc.GetVariantVersionParams{ID: v.ID, ProductID: productID})
	if errors.Is(err, sql.ErrNoRows) {
		return ErrUnknownVariant
	}
	if err != nil {
		return fmt.Errorf("query variant version: %w", err)
	}
	return &VersionConflictError{VariantID: v.ID}
}

// updateProduct writes the product's fields and recomputes price_from. It is
// the last step of every write, after the variants have changed.
func updateProduct(ctx context.Context, q *sqlc.Queries, id string, in Input) error {
	n, err := q.UpdateProduct(ctx, sqlc.UpdateProductParams{
		ID: id, CategoryID: in.CategoryID, Slug: in.Slug, Name: in.Name, Description: in.Description, Status: in.Status,
	})
	if err != nil {
		return writeError("update product", err)
	}
	if n == 0 {
		return ErrNotFound
	}
	return nil
}

// writeError turns the constraint violations a client can cause into the
// package's errors, matched by the constraint names in the migration, and
// wraps anything else with what was being done. A nil err stays nil.
func writeError(action string, err error) error {
	if err == nil {
		return nil
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		if pgErr.Code == "22021" { // invalid UTF-8 or NUL: a backstop for the handler's checks
			return ErrInvalidText
		}
		switch pgErr.ConstraintName {
		case "products_slug_key":
			return ErrSlugTaken
		case "product_variants_sku_key":
			return ErrSKUTaken
		case "products_category_fkey":
			return ErrUnknownCategory
		}
	}
	return fmt.Errorf("%s: %w", action, err)
}
