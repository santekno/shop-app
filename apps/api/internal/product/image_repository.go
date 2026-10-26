package product

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// CreatePendingImage records a new pending upload of productID, at the
// next position, in one transaction that locks the product first, so two
// uploads take turns on MaxImagesPerProduct. Errors: ErrNotFound,
// ErrImageLimit.
func (r *PostgresRepository) CreatePendingImage(ctx context.Context, productID, contentType string, size int32) (Image, error) {
	img := Image{ID: uuidx.NewV7(), ProductID: productID, Status: ImagePendingUpload, ContentType: contentType, SizeBytes: size}
	img.OriginalKey = ImageKey(productID, img.ID)
	err := database.WithTx(ctx, r.db, func(q *sqlc.Queries) error {
		if _, err := q.LockProductForImages(ctx, productID); errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		} else if err != nil {
			return fmt.Errorf("lock product: %w", err)
		}
		count, err := q.CountProductImages(ctx, productID)
		if err != nil {
			return fmt.Errorf("count images: %w", err)
		}
		if count.Images >= MaxImagesPerProduct {
			return ErrImageLimit
		}
		img.Position = count.NextPosition
		row, err := q.InsertProductImage(ctx, sqlc.InsertProductImageParams{
			ID: img.ID, ProductID: productID, Position: img.Position, ContentType: contentType,
			SizeBytes: size, OriginalKey: img.OriginalKey,
		})
		if err != nil {
			return fmt.Errorf("insert image: %w", err)
		}
		img.CreatedAt, img.UpdatedAt = row.CreatedAt, row.UpdatedAt
		return nil
	})
	return img, err
}

// GetImage returns image imageID of productID, or ErrImageNotFound.
func (r *PostgresRepository) GetImage(ctx context.Context, productID, imageID string) (Image, error) {
	row, err := r.q.GetProductImage(ctx, sqlc.GetProductImageParams{ID: imageID, ProductID: productID})
	if errors.Is(err, sql.ErrNoRows) {
		return Image{}, ErrImageNotFound
	}
	if err != nil {
		return Image{}, fmt.Errorf("query image: %w", err)
	}
	return fromImageRow(row), nil
}

// ConfirmImage moves the pending img to status with its alt text and
// dimensions. ErrImageNotFound: it was confirmed or deleted meanwhile.
func (r *PostgresRepository) ConfirmImage(ctx context.Context, img Image, status string) error {
	n, err := r.q.ConfirmProductImage(ctx, sqlc.ConfirmProductImageParams{
		ID: img.ID, ProductID: img.ProductID, Status: status, Alt: img.Alt,
		Width: sql.NullInt32{Int32: img.Width, Valid: true}, Height: sql.NullInt32{Int32: img.Height, Valid: true},
	})
	if err != nil {
		return fmt.Errorf("confirm image: %w", err)
	}
	if n == 0 {
		return ErrImageNotFound
	}
	return nil
}

// DeleteImage deletes image imageID of productID, or ErrImageNotFound.
func (r *PostgresRepository) DeleteImage(ctx context.Context, productID, imageID string) error {
	n, err := r.q.DeleteProductImage(ctx, sqlc.DeleteProductImageParams{ID: imageID, ProductID: productID})
	if err != nil {
		return fmt.Errorf("delete image: %w", err)
	}
	if n == 0 {
		return ErrImageNotFound
	}
	return nil
}

// imagesOf returns every image of the products, by product ID, in order.
func (r *PostgresRepository) imagesOf(ctx context.Context, productIDs []string) (map[string][]Image, error) {
	rows, err := r.q.ListProductImages(ctx, productIDs)
	if err != nil {
		return nil, fmt.Errorf("query images: %w", err)
	}
	out := make(map[string][]Image, len(productIDs))
	for _, row := range rows {
		out[row.ProductID] = append(out[row.ProductID], fromImageRow(row))
	}
	return out, nil
}

// attachImages sets the storefront images (ready ones only) of products,
// with one query for the whole page.
func (r *PostgresRepository) attachImages(ctx context.Context, products []Product) error {
	if len(products) == 0 {
		return nil
	}
	ids := make([]string, len(products))
	for i, p := range products {
		ids[i] = p.ID
	}
	images, err := r.imagesOf(ctx, ids)
	if err != nil {
		return err
	}
	for i := range products {
		for _, img := range images[products[i].ID] {
			if img.Status == ImageReady {
				products[i].Images = append(products[i].Images, img)
			}
		}
	}
	return nil
}

// ProcessingImages returns up to limit confirmed images waiting for their
// variants, oldest first.
func (r *PostgresRepository) ProcessingImages(ctx context.Context, limit int32) ([]Image, error) {
	rows, err := r.q.ListProcessingImages(ctx, limit)
	if err != nil {
		return nil, fmt.Errorf("query processing images: %w", err)
	}
	out := make([]Image, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromImageRow(row))
	}
	return out, nil
}

// FinishImage moves the processing image id to status with its variants.
// ErrImageNotFound: deleted or finished meanwhile.
func (r *PostgresRepository) FinishImage(ctx context.Context, id, status string, variants []ImageVariant) error {
	if variants == nil {
		variants = []ImageVariant{}
	}
	raw, err := json.Marshal(variants)
	if err != nil {
		return fmt.Errorf("encode variants: %w", err)
	}
	n, err := r.q.FinishProductImage(ctx, sqlc.FinishProductImageParams{ID: id, Status: status, Variants: raw})
	if err != nil {
		return fmt.Errorf("finish image: %w", err)
	}
	if n == 0 {
		return ErrImageNotFound
	}
	return nil
}

func fromImageRow(row sqlc.ProductImage) Image {
	img := Image{
		ID: row.ID, ProductID: row.ProductID, Position: row.Position, Alt: row.Alt, Status: row.Status,
		ContentType: row.ContentType, SizeBytes: row.SizeBytes, OriginalKey: row.OriginalKey,
		Width: row.Width.Int32, Height: row.Height.Int32, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	// The worker wrote it; a row that does not decode simply has none.
	_ = json.Unmarshal(row.Variants, &img.Variants)
	return img
}

// DeleteStalePendingImages deletes up to limit pending uploads created
// before before, and returns their files' keys.
func (r *PostgresRepository) DeleteStalePendingImages(ctx context.Context, before time.Time, limit int32) ([]string, error) {
	keys, err := r.q.DeleteStalePendingImages(ctx, sqlc.DeleteStalePendingImagesParams{Before: before, BatchSize: limit})
	if err != nil {
		return nil, fmt.Errorf("delete stale pending images: %w", err)
	}
	return keys, nil
}
