package banner

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// Repository is where banners are stored. The service depends on this
// interface, so a test can hand it a fake instead of PostgreSQL.
type Repository interface {
	// ListActive returns the active banners in carousel order.
	ListActive(ctx context.Context) ([]Banner, error)
}

// PostgresRepository reads banners from PostgreSQL with the queries sqlc
// generated from internal/db/queries/banners.sql.
type PostgresRepository struct {
	q *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{q: sqlc.New(db)}
}

// ListActive returns the active banners ordered by position, then id.
func (r *PostgresRepository) ListActive(ctx context.Context) ([]Banner, error) {
	rows, err := r.q.ListActiveBanners(ctx)
	if err != nil {
		return nil, fmt.Errorf("query banners: %w", err)
	}
	banners := make([]Banner, 0, len(rows))
	for _, row := range rows {
		banners = append(banners, Banner{
			ID:               row.ID,
			Title:            row.Title,
			Subtitle:         row.Subtitle.String,
			CTALabel:         row.CtaLabel.String,
			LinkCategorySlug: row.LinkCategorySlug.String,
			BackgroundColor:  row.BackgroundColor,
		})
	}
	return banners, nil
}
