//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/outbox"
)

// TestRace_GuestCartCleanupVersusAdd: a guest comes back to a cart
// untouched for 31 days and adds a line at the moment the hourly cleanup
// deletes abandoned carts. Every write to a guest cart touches the cart
// row, so the cleanup either deleted the cart first (the add is 404
// CART_NOT_FOUND and the guest starts a new cart) or re-checks the row
// the add changed and keeps it with both lines. Never an add that
// answered success with its line gone.
func TestRace_GuestCartCleanupVersusAdd(t *testing.T) {
	sh := newShop(t, nil)
	p := sh.product(t, "kaos-keranjang-tamu", variant("KT-M", "M", 10000, 100000), variant("KT-L", "L", 10000, 100000))
	m, l := p.Variants["KT-M"], p.Variants["KT-L"]
	repo := cart.NewPostgresRepository(sh.db)
	ops := []string{"add", "set quantity"}
	tally := map[string]int{}
	for i := range raceIterations {
		op := ops[i%len(ops)]
		token := assertCart(t, sh.addItem(t, "", "", m, 1), "guest add").Token
		cartID := queryStrings(t, sh.db, `SELECT id::text FROM carts WHERE user_id IS NULL ORDER BY created_at DESC LIMIT 1`)[0]
		mustExec(t, sh.db, `UPDATE carts SET updated_at = now() - interval '31 days' WHERE id = $1`, cartID)
		mustExec(t, sh.db, `UPDATE cart_items SET updated_at = now() - interval '31 days' WHERE cart_id = $1`, cartID)
		var deleted int64
		var cleanErr error
		results := runTogether(t,
			func() (response, error) {
				if op == "add" {
					return sh.tryCall(http.MethodPost, "/v1/cart/items", map[string]any{"variant_id": l, "quantity": 2}, "", cartHeaders(token))
				}
				return sh.tryCall(http.MethodPatch, "/v1/cart/items/"+m, map[string]any{"quantity": 3}, "", cartHeaders(token))
			},
			func() (response, error) {
				// The HTTP write is slower than the DELETE; starting the
				// cleanup 0-12 ms later lets either one go first.
				time.Sleep(time.Duration(i%5) * 3 * time.Millisecond)
				deleted, cleanErr = repo.DeleteAbandonedGuestCarts(context.Background(), time.Now())
				return response{Status: http.StatusOK}, nil
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if cleanErr != nil {
			t.Fatalf("iteration %d: cleanup: %v", i, cleanErr)
		}
		exists := sh.count(t, `SELECT count(*) FROM carts WHERE id = $1`, cartID) == 1
		switch {
		case results[0].Status == http.StatusOK || results[0].Status == http.StatusCreated:
			if !exists || deleted != 0 {
				t.Fatalf("iteration %d: %s answered %d, but the cart exists=%v (cleanup deleted %d): the line was lost",
					i, op, results[0].Status, exists, deleted)
			}
			got := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, "", token), "cart after the race").quantities()
			want := map[string]int32{m: 1, l: 2}
			if op == "set quantity" {
				want = map[string]int32{m: 3}
			}
			if fmt.Sprint(got) != fmt.Sprint(want) {
				t.Fatalf("iteration %d: cart %v, want %v", i, got, want)
			}
			tally["write first"]++
		case is(results[0], http.StatusNotFound, "CART_NOT_FOUND"):
			if exists || deleted != 1 {
				t.Fatalf("iteration %d: 404, but the cart exists=%v (cleanup deleted %d)", i, exists, deleted)
			}
			tally["cleanup first"]++
		default:
			t.Fatalf("iteration %d: %s = %s", i, op, describe(results[0]))
		}
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// TestRace_OutboxDispatcherVersusCleanup: the daily cleanup deletes week-
// old published events while the dispatcher publishes a fresh backlog.
// The dispatcher only touches unpublished rows and the cleanup only old
// published ones: every new event is published exactly once and kept,
// every old one and its delivery records are deleted, and neither waits
// for the other.
func TestRace_OutboxDispatcherVersusCleanup(t *testing.T) {
	sh := newShop(t, nil)
	const backlog = outbox.BatchSize + 50
	for i := range raceIterations {
		fresh, old := make([]string, backlog), make([]string, backlog)
		for j := range fresh {
			fresh[j], old[j] = uuidx.NewV7(), uuidx.NewV7()
		}
		mustExec(t, sh.db, `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, created_at, published_at)
			SELECT id, 'order', gen_random_uuid(), 'order.created', '{}'::jsonb, now() - interval '9 days' + n * interval '1 microsecond',
			       now() - interval '8 days'
			FROM unnest($1::uuid[]) WITH ORDINALITY AS e(id, n)`, old)
		mustExec(t, sh.db, `INSERT INTO event_deliveries (event_id, consumer, delivered_at)
			SELECT id, 'email:order-confirmation', now() - interval '8 days' FROM unnest($1::uuid[]) AS e(id)`, old)
		mustExec(t, sh.db, `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, created_at)
			SELECT id, 'order', gen_random_uuid(), 'order.created', '{}'::jsonb, now() + n * interval '1 microsecond'
			FROM unnest($1::uuid[]) WITH ORDINALITY AS e(id, n)`, fresh)

		pub := &recordingPublisher{}
		var published int
		var deleted int64
		var pubErr, cleanErr error
		together(
			func() { published, pubErr = outbox.NewDispatcher(sh.db, pub).PublishPending(context.Background()) },
			func() { deleted, cleanErr = outbox.Cleanup(context.Background(), sh.db, time.Now()) })
		if pubErr != nil || cleanErr != nil {
			t.Fatalf("iteration %d: dispatcher %v, cleanup %v", i, pubErr, cleanErr)
		}
		if published != backlog || deleted != backlog {
			t.Fatalf("iteration %d: published %d and deleted %d, want %d each", i, published, deleted, backlog)
		}
		seen := map[string]int{}
		for _, id := range pub.ids {
			seen[id]++
		}
		for _, id := range fresh {
			if seen[id] != 1 {
				t.Fatalf("iteration %d: event %s published %d times", i, id, seen[id])
			}
		}
		if n := sh.count(t, `SELECT count(*) FROM outbox_events WHERE id = ANY($1) AND published_at IS NOT NULL`, fresh); n != backlog {
			t.Fatalf("iteration %d: %d of %d fresh events kept and marked", i, n, backlog)
		}
		if n := sh.count(t, `SELECT count(*) FROM outbox_events WHERE id = ANY($1)`, old); n != 0 {
			t.Fatalf("iteration %d: %d old events left", i, n)
		}
		if n := sh.count(t, `SELECT count(*) FROM event_deliveries`); n != 0 {
			t.Fatalf("iteration %d: %d old delivery records left", i, n)
		}
		mustExec(t, sh.db, `DELETE FROM outbox_events`)
	}
}
