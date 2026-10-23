package order

import (
	"context"
	"errors"
	"fmt"

	"github.com/santekno/shop-app/apps/api/internal/address"
	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

// Carts reads a buyer's cart; cart.Service is one.
type Carts interface {
	Get(ctx context.Context, owner cart.Owner) (cart.Cart, error)
}

// Addresses reads a buyer's address; address.Service is one. Another
// user's address is address.ErrNotFound.
type Addresses interface {
	Get(ctx context.Context, userID, id string) (address.Address, error)
}

// Deps is what the service needs; every field is required.
type Deps struct {
	Carts     Carts
	Addresses Addresses
	Shipping  shipping.Provider
	// OriginPostalCode is where parcels leave from
	// (APP_SHIPPING_ORIGIN_POSTAL_CODE); the static table ignores it.
	OriginPostalCode string
}

// Service is checkout and orders.
type Service struct {
	carts     Carts
	addresses Addresses
	shipping  shipping.Provider
	origin    string
}

// NewService returns a Service built from deps.
func NewService(deps Deps) *Service {
	return &Service{
		carts: deps.Carts, addresses: deps.Addresses, shipping: deps.Shipping, origin: deps.OriginPostalCode,
	}
}

// Errors about the checkout input.
var (
	// ErrUnknownAddress: the address ID names none of the buyer's
	// addresses.
	ErrUnknownAddress = errors.New("unknown address")
	// ErrUnknownShippingService: the courier does not offer that service
	// for this parcel (now).
	ErrUnknownShippingService = errors.New("unknown shipping service")
)

// PreviewInput is what the buyer has chosen so far. Every field may be
// empty; Courier and Service need AddressID.
type PreviewInput struct {
	AddressID string
	Courier   shipping.Courier
	Service   string
}

// Preview is what checkout would charge now, without writing anything.
type Preview struct {
	Lines  []cart.Line
	Totals Totals
	// Shipping is the chosen service's quote; nil until one is chosen.
	Shipping *shipping.Quote
}

// Preview validates userID's cart the way checkout will (ErrCartEmpty, or a
// *ProblemsError listing every line that cannot be bought as it is) and
// computes the totals, with the shipping fee once a courier service is
// chosen. Checkout validates again on locked rows, so a preview that
// passed is a hint, not a promise.
func (s *Service) Preview(ctx context.Context, userID string, in PreviewInput) (Preview, error) {
	lines, err := s.validCart(ctx, userID)
	if err != nil {
		return Preview{}, err
	}
	p := Preview{Lines: lines}
	totals := CalculateTotals(TotalsInput{Lines: totalsLines(lines)})
	if in.AddressID != "" {
		a, err := s.address(ctx, userID, in.AddressID)
		if err != nil {
			return Preview{}, err
		}
		if in.Courier != "" {
			q, err := s.quote(ctx, a, totals, in.Courier, in.Service)
			if err != nil {
				return Preview{}, err
			}
			p.Shipping = &q
			totals = CalculateTotals(TotalsInput{Lines: totalsLines(lines), ShippingFee: q.Price})
		}
	}
	p.Totals = totals
	return p, nil
}

// Quotes is every courier service that can carry userID's cart to their
// address addressID, cheapest first.
type Quotes struct {
	WeightGrams int64
	Quotes      []shipping.Quote
}

// ShippingQuotes prices userID's cart to their address addressID with every
// courier. Errors: ErrCartEmpty, ErrUnknownAddress, shipping.ErrUnavailable.
// Lines with problems still count: the buyer fixes them before paying, and
// the fee is asked for again at checkout.
func (s *Service) ShippingQuotes(ctx context.Context, userID, addressID string) (Quotes, error) {
	c, err := s.carts.Get(ctx, cart.Owner{UserID: userID})
	if err != nil {
		return Quotes{}, fmt.Errorf("shipping quotes: %w", err)
	}
	if len(c.Lines) == 0 {
		return Quotes{}, ErrCartEmpty
	}
	a, err := s.address(ctx, userID, addressID)
	if err != nil {
		return Quotes{}, err
	}
	totals := CalculateTotals(TotalsInput{Lines: totalsLines(c.Lines)})
	quotes, err := s.shipping.Quote(ctx, s.shippingRequest(a, totals))
	if err != nil {
		return Quotes{}, fmt.Errorf("shipping quotes: %w", err)
	}
	return Quotes{WeightGrams: totals.WeightGrams, Quotes: quotes}, nil
}

// validCart returns userID's cart lines when every one can be bought.
func (s *Service) validCart(ctx context.Context, userID string) ([]cart.Line, error) {
	c, err := s.carts.Get(ctx, cart.Owner{UserID: userID})
	if err != nil {
		return nil, fmt.Errorf("read cart: %w", err)
	}
	if len(c.Lines) == 0 {
		return nil, ErrCartEmpty
	}
	if err := validateLines(c.Lines); err != nil {
		return nil, err
	}
	return c.Lines, nil
}

// address returns userID's address id, or ErrUnknownAddress.
func (s *Service) address(ctx context.Context, userID, id string) (address.Address, error) {
	a, err := s.addresses.Get(ctx, userID, id)
	if errors.Is(err, address.ErrNotFound) {
		return address.Address{}, ErrUnknownAddress
	}
	if err != nil {
		return address.Address{}, fmt.Errorf("read address: %w", err)
	}
	return a, nil
}

// quote asks the provider for the parcel of totals to a, and returns the
// chosen service's quote. The fee always comes from the provider, never
// from the client.
func (s *Service) quote(ctx context.Context, a address.Address, totals Totals, courier shipping.Courier, service string) (shipping.Quote, error) {
	quotes, err := s.shipping.Quote(ctx, s.shippingRequest(a, totals))
	if err != nil {
		return shipping.Quote{}, fmt.Errorf("quote shipping: %w", err)
	}
	q, ok := shipping.Find(quotes, courier, service)
	if !ok {
		return shipping.Quote{}, ErrUnknownShippingService
	}
	return q, nil
}

func (s *Service) shippingRequest(a address.Address, totals Totals) shipping.Request {
	return shipping.Request{
		OriginPostalCode: s.origin, DestinationPostalCode: a.PostalCode,
		WeightGrams: totals.WeightGrams, Value: totals.Subtotal,
	}
}
