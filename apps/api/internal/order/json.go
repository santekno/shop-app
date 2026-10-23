package order

import (
	"time"

	"github.com/santekno/shop-app/apps/api/internal/cart"
)

// The order JSON shapes of the contract (Order in api/openapi.yaml).

type itemJSON struct {
	ID          string         `json:"id"`
	VariantID   string         `json:"variant_id"`
	ProductName string         `json:"product_name"`
	VariantName string         `json:"variant_name"`
	SKU         string         `json:"sku"`
	UnitPrice   cart.MoneyJSON `json:"unit_price"`
	Quantity    int32          `json:"quantity"`
	LineTotal   cart.MoneyJSON `json:"line_total"`
}

type addressJSON struct {
	RecipientName string `json:"recipient_name"`
	Phone         string `json:"phone"`
	Street        string `json:"street"`
	City          string `json:"city"`
	Province      string `json:"province"`
	PostalCode    string `json:"postal_code"`
}

type shipmentJSON struct {
	Courier        string      `json:"courier"`
	Service        string      `json:"service"`
	TrackingNumber *string     `json:"tracking_number"`
	Address        addressJSON `json:"address"`
}

type orderJSON struct {
	ID               string       `json:"id"`
	Code             string       `json:"code"`
	Status           string       `json:"status"`
	CancelReason     *string      `json:"cancel_reason"`
	Items            []itemJSON   `json:"items"`
	Totals           totalsJSON   `json:"totals"`
	VoucherCode      *string      `json:"voucher_code"`
	Shipping         shipmentJSON `json:"shipping"`
	PaymentExpiresAt time.Time    `json:"payment_expires_at"`
	PaidAt           *time.Time   `json:"paid_at"`
	ShippedAt        *time.Time   `json:"shipped_at"`
	CompletedAt      *time.Time   `json:"completed_at"`
	CancelledAt      *time.Time   `json:"cancelled_at"`
	CreatedAt        time.Time    `json:"created_at"`
	UpdatedAt        time.Time    `json:"updated_at"`
}

func toOrderJSON(o Order) orderJSON {
	out := orderJSON{
		ID: o.ID, Code: o.Code, Status: string(o.Status), CancelReason: o.CancelReason,
		Items: make([]itemJSON, 0, len(o.Items)), Totals: toTotalsJSON(o.Totals), VoucherCode: o.VoucherCode,
		Shipping: shipmentJSON{
			Courier: o.Courier, Service: o.CourierService, TrackingNumber: o.TrackingNumber,
			Address: addressJSON{
				RecipientName: o.Address.Recipient, Phone: o.Address.Phone, Street: o.Address.Street,
				City: o.Address.City, Province: o.Address.Province, PostalCode: o.Address.PostalCode,
			},
		},
		PaymentExpiresAt: o.PaymentExpiresAt.UTC(), PaidAt: utc(o.PaidAt), ShippedAt: utc(o.ShippedAt),
		CompletedAt: utc(o.CompletedAt), CancelledAt: utc(o.CancelledAt),
		CreatedAt: o.CreatedAt.UTC(), UpdatedAt: o.UpdatedAt.UTC(),
	}
	for _, it := range o.Items {
		out.Items = append(out.Items, itemJSON{
			ID: it.ID, VariantID: it.VariantID, ProductName: it.ProductName, VariantName: it.VariantName,
			SKU: it.SKU, UnitPrice: cart.Rupiah(it.UnitPrice), Quantity: it.Quantity, LineTotal: cart.Rupiah(it.LineTotal),
		})
	}
	return out
}

func utc(t *time.Time) *time.Time {
	if t == nil {
		return nil
	}
	u := t.UTC()
	return &u
}
