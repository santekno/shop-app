// Package shipping prices a parcel with the couriers GoShop offers: JNE,
// J&T and SiCepat (ADR 0006). Checkout depends on the Provider interface;
// Static is a fixed table for development and tests, Biteship asks
// Biteship's rates API.
package shipping

import (
	"context"
	"errors"
	"slices"
)

// Courier is a courier GoShop ships with; the values are the
// orders_courier_check constraint's.
type Courier string

// The couriers of docs/prd.md (F6).
const (
	CourierJNE     Courier = "jne"
	CourierJNT     Courier = "jnt"
	CourierSiCepat Courier = "sicepat"
)

// Couriers is every courier, in the order quotes are listed.
var Couriers = []Courier{CourierJNE, CourierJNT, CourierSiCepat}

// Valid reports whether c is one of Couriers.
func (c Courier) Valid() bool { return slices.Contains(Couriers, c) }

// Request is one parcel to price.
type Request struct {
	// OriginPostalCode is the store's warehouse; DestinationPostalCode
	// the buyer's address.
	OriginPostalCode      string
	DestinationPostalCode string
	// WeightGrams is the weight of every unit, at least 1.
	WeightGrams int64
	// Value is the goods' price in rupiah, for the courier's insurance
	// and some couriers' rates.
	Value int64
}

// Quote is one service a courier offers for a parcel.
type Quote struct {
	Courier     Courier
	CourierName string // e.g. "J&T Express"
	// Service is the courier's service code, upper-case: REG, YES, EZ.
	Service     string
	ServiceName string
	// Price is the fee in whole rupiah.
	Price int64
	// ETD is the estimated delivery time as the courier says it, e.g.
	// "2-3 days".
	ETD string
}

// Provider prices parcels.
type Provider interface {
	// Name is "static" or "biteship", for logs.
	Name() string
	// Quote returns every service of Couriers that can carry the parcel,
	// cheapest first. ErrNotServed means no courier serves the route;
	// ErrUnavailable means the provider could not answer.
	Quote(ctx context.Context, req Request) ([]Quote, error)
}

// ErrUnavailable means the provider did not answer in time or answered
// with an error. The cause is wrapped for the log, never shown to clients.
var ErrUnavailable = errors.New("shipping provider unavailable")

// ErrNotServed means the provider answered, and refused the parcel: no
// courier serves this destination (a postal code it does not know or
// reach). Retrying does not help; another address might.
var ErrNotServed = errors.New("no courier serves this address")

// Find returns the quote of courier's service, if quotes has it.
func Find(quotes []Quote, courier Courier, service string) (Quote, bool) {
	for _, q := range quotes {
		if q.Courier == courier && q.Service == service {
			return q, true
		}
	}
	return Quote{}, false
}

// sortByPrice orders quotes cheapest first, then by courier and service, so
// the list is the same on every call.
func sortByPrice(quotes []Quote) {
	slices.SortStableFunc(quotes, func(a, b Quote) int {
		switch {
		case a.Price != b.Price:
			return compare(a.Price, b.Price)
		case a.Courier != b.Courier:
			return compare(a.Courier, b.Courier)
		default:
			return compare(a.Service, b.Service)
		}
	})
}

func compare[T int64 | string | Courier](a, b T) int {
	switch {
	case a < b:
		return -1
	case a > b:
		return 1
	default:
		return 0
	}
}
