package order

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
)

// PostgresRepository stores orders in PostgreSQL with the queries sqlc
// generated from internal/db/queries.
type PostgresRepository struct {
	db *sql.DB
	q  *sqlc.Queries
}

// NewPostgresRepository returns a repository on db, the API's pool.
func NewPostgresRepository(db *sql.DB) *PostgresRepository {
	return &PostgresRepository{db: db, q: sqlc.New(db)}
}

// VoucherByCode returns the voucher with code (already normalized), or a
// *VoucherError with VoucherNotFound.
func (r *PostgresRepository) VoucherByCode(ctx context.Context, code string) (Voucher, error) {
	return voucherByCode(ctx, r.q, code)
}

func voucherByCode(ctx context.Context, q *sqlc.Queries, code string) (Voucher, error) {
	row, err := q.GetVoucherByCode(ctx, code)
	if errors.Is(err, sql.ErrNoRows) {
		return Voucher{}, &VoucherError{Code: code, Reason: VoucherNotFound}
	}
	if err != nil {
		return Voucher{}, fmt.Errorf("query voucher: %w", err)
	}
	return Voucher{
		ID: row.ID, Code: row.Code, Kind: row.Kind, Value: row.Value, MinSpend: row.MinSpend,
		MaxDiscount: row.MaxDiscount.Int64, StartsAt: row.StartsAt, EndsAt: row.EndsAt,
		UsageLimit: row.UsageLimit.Int32, UsedCount: row.UsedCount, PerUserLimit: row.PerUserLimit,
	}, nil
}

// VoucherUses is how many of userID's orders that are not cancelled used
// the voucher with id.
func (r *PostgresRepository) VoucherUses(ctx context.Context, voucherID, userID string) (int64, error) {
	n, err := r.q.CountVoucherUses(ctx, sqlc.CountVoucherUsesParams{VoucherID: &voucherID, UserID: userID})
	if err != nil {
		return 0, fmt.Errorf("count voucher uses: %w", err)
	}
	return n, nil
}

// Get returns userID's order id with its items, or ErrNotFound (another
// user's order included).
func (r *PostgresRepository) Get(ctx context.Context, userID, id string) (Order, error) {
	row, err := r.q.GetOrderForUser(ctx, sqlc.GetOrderForUserParams{ID: id, UserID: userID})
	if errors.Is(err, sql.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("query order: %w", err)
	}
	o := fromOrderRow(row)
	if o.Items, err = loadItems(ctx, r.q, id); err != nil {
		return Order{}, err
	}
	if o.LatestPayment, err = loadLatestPayment(ctx, r.q, id); err != nil {
		return Order{}, err
	}
	return o, nil
}

// orderRow is the columns every order read returns.
type orderRow = sqlc.GetOrderForUserRow

func fromOrderRow(row orderRow) Order {
	return Order{
		ID: row.ID, Code: row.Code, UserID: row.UserID, Status: Status(row.Status),
		CancelReason: nullString(row.CancelReason),
		Totals: Totals{
			Subtotal: row.Subtotal, Discount: row.Discount, ShippingFee: row.ShippingFee,
			Total: row.Total, WeightGrams: int64(row.TotalWeightGrams),
		},
		VoucherCode: nullString(row.VoucherCode), Courier: row.Courier, CourierService: row.CourierService,
		TrackingNumber: nullString(row.TrackingNumber),
		Address: ShippingAddress{
			Recipient: row.ShippingRecipient, Phone: row.ShippingPhone, Street: row.ShippingStreet,
			City: row.ShippingCity, Province: row.ShippingProvince, PostalCode: row.ShippingPostalCode,
		},
		PaymentExpiresAt: row.PaymentExpiresAt, PaidAt: nullTime(row.PaidAt), ShippedAt: nullTime(row.ShippedAt),
		CompletedAt: nullTime(row.CompletedAt), CancelledAt: nullTime(row.CancelledAt),
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
}

func loadItems(ctx context.Context, q *sqlc.Queries, orderID string) ([]Item, error) {
	rows, err := q.ListOrderItems(ctx, orderID)
	if err != nil {
		return nil, fmt.Errorf("query order items: %w", err)
	}
	items := make([]Item, 0, len(rows))
	for _, row := range rows {
		items = append(items, Item{
			ID: row.ID, VariantID: row.VariantID, ProductName: row.ProductName, VariantName: row.VariantName,
			SKU: row.Sku, UnitPrice: row.UnitPrice, Quantity: row.Quantity, LineTotal: row.LineTotal,
		})
	}
	return items, nil
}

// loadLatestPayment reads the newest payment of orderID, or nil when it
// has none. It runs after the order read, which already checked who may
// see the order.
func loadLatestPayment(ctx context.Context, q *sqlc.Queries, orderID string) (*LatestPayment, error) {
	row, err := q.GetLatestPaymentOfOrder(ctx, orderID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("query latest payment: %w", err)
	}
	return &LatestPayment{Status: row.Status, ExpiresAt: row.ExpiresAt, UpdatedAt: row.UpdatedAt}, nil
}

func nullString(s sql.NullString) *string {
	if !s.Valid {
		return nil
	}
	return &s.String
}

func nullTime(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	return &t.Time
}

// GetAny returns any order with its items, for sellers and admins, or
// ErrNotFound.
func (r *PostgresRepository) GetAny(ctx context.Context, id string) (Order, error) {
	row, err := r.q.GetOrder(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Order{}, ErrNotFound
	}
	if err != nil {
		return Order{}, fmt.Errorf("query order: %w", err)
	}
	o := fromOrderRow(orderRow(row))
	if o.Items, err = loadItems(ctx, r.q, id); err != nil {
		return Order{}, err
	}
	if o.LatestPayment, err = loadLatestPayment(ctx, r.q, id); err != nil {
		return Order{}, err
	}
	return o, nil
}

// StatusQuery selects one page of the admin queue.
type StatusQuery struct {
	Status Status
	After  position
	Limit  int
}

// ListByStatus returns up to q.Limit orders in q.Status after q.After,
// newest first, without their items.
func (r *PostgresRepository) ListByStatus(ctx context.Context, q StatusQuery) ([]Order, error) {
	rows, err := r.q.ListOrdersByStatus(ctx, sqlc.ListOrdersByStatusParams{
		Status: string(q.Status), CursorCreatedAt: q.After.CreatedAt, CursorID: q.After.ID,
		PageSize: int32(q.Limit), // #nosec G115 -- at most MaxPageSize + 1
	})
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	out := make([]Order, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromOrderRow(orderRow(row)))
	}
	return out, nil
}

// HistoryQuery selects one page of a buyer's orders.
type HistoryQuery struct {
	UserID string
	After  position
	Limit  int
}

// ListForUser returns up to q.Limit of q.UserID's orders after q.After,
// newest first, without their items.
func (r *PostgresRepository) ListForUser(ctx context.Context, q HistoryQuery) ([]Order, error) {
	rows, err := r.q.ListOrdersForUser(ctx, sqlc.ListOrdersForUserParams{
		UserID: q.UserID, CursorCreatedAt: q.After.CreatedAt, CursorID: q.After.ID,
		PageSize: int32(q.Limit), // #nosec G115 -- at most MaxPageSize + 1
	})
	if err != nil {
		return nil, fmt.Errorf("query orders: %w", err)
	}
	out := make([]Order, 0, len(rows))
	for _, row := range rows {
		out = append(out, fromOrderRow(orderRow(row)))
	}
	return out, nil
}
