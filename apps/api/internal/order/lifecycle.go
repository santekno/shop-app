package order

import (
	"context"
	"errors"
	"fmt"
)

// Who may move an order where (ADR 0006): the payment webhook marks it
// paid (Bab 6); a seller or admin moves it through processing and shipping
// and may cancel it before it ships; a buyer may cancel it while unpaid
// and confirm receipt once shipped; the expiry job cancels it when the
// payment deadline passes.

// MarkPaid moves order id from pending_payment to paid. Bab 6's Midtrans
// webhook calls it; Bab 5 has no route for it.
func (s *Service) MarkPaid(ctx context.Context, id string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusPaid})
}

// StartProcessing is the seller starting to pack a paid order.
func (s *Service) StartProcessing(ctx context.Context, id string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusProcessing})
}

// Ship is the seller handing the parcel to the courier, with its airway
// bill.
func (s *Service) Ship(ctx context.Context, id, trackingNumber string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusShipped, TrackingNumber: trackingNumber})
}

// Complete marks a shipped order received: by the buyer (buyerID set, only
// their own order) or by a seller or admin (buyerID empty).
func (s *Service) Complete(ctx context.Context, buyerID, id string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusCompleted, BuyerID: buyerID})
}

// CancelByBuyer cancels the buyer's own unpaid order and returns its stock.
func (s *Service) CancelByBuyer(ctx context.Context, buyerID, id string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusCancelled, BuyerID: buyerID, CancelReason: CancelBuyerCancelled})
}

// CancelBySeller cancels an order that has not shipped and returns its
// stock. A paid order's refund is Bab 6's.
func (s *Service) CancelBySeller(ctx context.Context, id string) error {
	return s.transition(ctx, Change{OrderID: id, To: StatusCancelled, CancelReason: CancelSellerCancelled})
}

// ExpireBatchSize is how many unpaid orders ExpireDue reads at a time.
const ExpireBatchSize = 100

// ExpireDue cancels every unpaid order whose payment deadline has passed,
// each in its own transaction (so one failure does not undo the others),
// and returns how many it cancelled. `api expire-orders` runs it once; Bab
// 6's worker runs it on a ticker. Running it twice at once is safe: the
// guarded UPDATE lets only one of them cancel each order.
func (s *Service) ExpireDue(ctx context.Context) (int, error) {
	now := s.now()
	expired := 0
	for {
		ids, err := s.repo.ExpiredOrderIDs(ctx, now, ExpireBatchSize)
		if err != nil {
			return expired, err
		}
		for _, id := range ids {
			err := s.repo.Transition(ctx, Change{OrderID: id, To: StatusCancelled, CancelReason: CancelPaymentExpired, Now: now})
			var moved *TransitionError
			switch {
			case err == nil:
				expired++
			case errors.As(err, &moved):
				// Paid or cancelled since it was listed: nothing to do.
			default:
				return expired, fmt.Errorf("expire order %s: %w", id, err)
			}
		}
		if len(ids) < ExpireBatchSize {
			return expired, nil
		}
	}
}

func (s *Service) transition(ctx context.Context, c Change) error {
	c.Now = s.now()
	if err := s.repo.Transition(ctx, c); err != nil {
		return fmt.Errorf("order %s to %s: %w", c.OrderID, c.To, err)
	}
	return nil
}

// GetForStaff returns any order, for sellers and admins.
func (s *Service) GetForStaff(ctx context.Context, id string) (Order, error) {
	o, err := s.repo.GetAny(ctx, id)
	if err != nil {
		return Order{}, fmt.Errorf("get order %s: %w", id, err)
	}
	return o, nil
}

// Queue returns one page of the orders in status, newest first: the
// seller's work list (paid orders to pack, processing ones to ship).
func (s *Service) Queue(ctx context.Context, status Status, cursor string, limit int) (Page, error) {
	if limit < 1 || limit > MaxPageSize {
		return Page{}, fmt.Errorf("order queue: limit %d out of range", limit)
	}
	list := "status:" + string(status)
	after, err := decodeCursor(list, cursor)
	if err != nil {
		return Page{}, err
	}
	rows, err := s.repo.ListByStatus(ctx, StatusQuery{Status: status, After: after, Limit: limit + 1})
	if err != nil {
		return Page{}, fmt.Errorf("order queue: %w", err)
	}
	return paginate(list, rows, limit), nil
}
