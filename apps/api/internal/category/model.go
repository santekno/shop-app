// Package category is the catalog's category feature: the categories buyers
// browse by, two levels deep (for example Pakaian → Kaos).
package category

import "errors"

// ErrNotFound means no category has the slug.
var ErrNotFound = errors.New("category not found")

// Category is one category. ParentID is nil for a top-level category.
type Category struct {
	ID       string
	Slug     string
	Name     string
	ParentID *string
}

// IsTopLevel reports whether c has no parent.
func (c Category) IsTopLevel() bool { return c.ParentID == nil }
