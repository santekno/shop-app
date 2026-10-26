// Package product is the catalog's product feature: the storefront's
// product list and detail, and the admin endpoints that write products with
// their variants. Price and stock live on the variants (docs/erd.md).
package product

import (
	"errors"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/category"
)

// Product statuses. Only active products are on the storefront.
const (
	StatusDraft    = "draft"
	StatusActive   = "active"
	StatusArchived = "archived"
)

// Sort is the order of the storefront list.
type Sort string

// The sorts the contract allows. Price sorts use price_from.
const (
	SortNewest    Sort = "newest"
	SortPriceAsc  Sort = "price_asc"
	SortPriceDesc Sort = "price_desc"
)

// Product is a product as the storefront shows it: active, with its
// sellable variants only.
type Product struct {
	ID          string
	Slug        string
	Name        string
	Description string
	Category    category.Category
	// PriceFrom is the price of the cheapest sellable variant, in whole
	// rupiah.
	PriceFrom int64
	Variants  []Variant
	// Images are the photos the storefront shows, in order.
	Images    []Image
	CreatedAt time.Time
}

// InStock reports whether at least one sellable variant has stock. It is
// computed from the variants every time, never stored, so it cannot go stale.
func (p Product) InStock() bool {
	for _, v := range p.Variants {
		if v.Stock > 0 {
			return true
		}
	}
	return false
}

// Variant is one sellable item of a product, for example one size.
type Variant struct {
	ID    string
	SKU   string
	Name  string
	Price int64 // whole rupiah
	Stock int32
}

// AdminProduct is a product as the admin sees it: any status, a price only
// while it has sellable variants, and the variants' weights.
type AdminProduct struct {
	ID          string
	CategoryID  string
	Slug        string
	Name        string
	Description string
	Status      string
	PriceFrom   *int64 // nil when no variant is sellable
	Variants    []AdminVariant
	// Images are all the product's photos, pending uploads included.
	Images    []Image
	CreatedAt time.Time
	UpdatedAt time.Time
}

// AdminVariant is a sellable variant with everything the admin can edit.
type AdminVariant struct {
	ID          string
	SKU         string
	Name        string
	Price       int64 // whole rupiah
	Stock       int32
	WeightGrams int32
	// Version changes with every write to the variant, a checkout's
	// stock decrement included; a save must send back the one it read.
	Version int32
}

// Input is what the admin writes: the product's fields and its complete
// list of sellable variants.
type Input struct {
	CategoryID  string
	Slug        string
	Name        string
	Description string
	Status      string
	Variants    []VariantInput
}

// VariantInput is one variant of an Input. ID is empty for a new variant
// and set for one that already exists, with the Version it was read at.
type VariantInput struct {
	ID          string
	Version     int32
	SKU         string
	Name        string
	Price       int64 // whole rupiah, above 0
	Stock       int32
	WeightGrams int32
}

// Errors the service returns; the handler turns each into its HTTP error.
var (
	// ErrNotFound: no product matches.
	ErrNotFound = errors.New("product not found")
	// ErrSlugTaken: another product already has the slug.
	ErrSlugTaken = errors.New("slug already taken")
	// ErrSKUTaken: a variant of any product, archived ones included,
	// already has one of the SKUs.
	ErrSKUTaken = errors.New("sku already taken")
	// ErrUnknownCategory: the category ID names no category.
	ErrUnknownCategory = errors.New("unknown category")
	// ErrUnknownVariant: a variant ID is not a sellable variant of the
	// product being saved.
	ErrUnknownVariant = errors.New("unknown variant")
	// ErrVersionConflict: a variant changed since the admin loaded it (a
	// sale, or another admin's save); reload and save again. See
	// VersionConflictError for which one.
	ErrVersionConflict = errors.New("version conflict")
	// ErrInvalidText: PostgreSQL refused a string (invalid UTF-8 or NUL)
	// that the handler's checks let through.
	ErrInvalidText = errors.New("invalid text")
)

// VersionConflictError is ErrVersionConflict for one variant.
type VersionConflictError struct {
	VariantID string
}

func (e *VersionConflictError) Error() string { return "variant " + e.VariantID + ": version conflict" }

// Unwrap makes errors.Is(err, ErrVersionConflict) true.
func (e *VersionConflictError) Unwrap() error { return ErrVersionConflict }
