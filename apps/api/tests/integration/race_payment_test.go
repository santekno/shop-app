//go:build integration

package integration_test

import (
	"context"
	"fmt"
	"net/http"
	"sync/atomic"
	"testing"
	"time"

	"github.com/santekno/shop-app/apps/api/internal/app"
	"github.com/santekno/shop-app/apps/api/internal/payment"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
)

// The payment races of ADR 0007: every path that closes or pays an order
// locks the order row first, then its payment, so a notification and a
// close never wait on each other in a circle, and whichever commits first
// decides; the other then sees the committed row. Each race runs
// raceIterations times from a barrier and is judged on the rows it leaves
// behind: an order is paid once or cancelled with its stock back once, a
// late payment is flagged for a refund, a closed order never keeps an open
// payment, and nothing is a 5xx or a deadlock.

// settlementOutcome is what a settlement racing a close left: the webhook
// either paid the order first (paid), or found it closed and flagged the
// payment (refund_required).
func (ps *payShop) assertSettledOrClosed(t *testing.T, i int, notifyResp response, o orderOut, paymentID string,
	closed bool, variantID string, stockBefore int, tally map[string]int,
) {
	t.Helper()
	row := ps.paymentRow(t, paymentID)
	status := ps.orderStatus(t, o.ID)
	switch {
	case !closed && is(notifyResp, http.StatusOK, "") && status == "paid":
		if row.Status != "paid" || row.RefundRequired || ps.stock(t, variantID) != stockBefore {
			t.Fatalf("iteration %d: paid first, but payment %+v, stock %d → %d", i, row, stockBefore, ps.stock(t, variantID))
		}
		ps.assertEvents(t, o.ID, "order.created", "order.paid")
		tally["paid first"]++
	case closed && is(notifyResp, http.StatusOK, "") && status == "cancelled":
		if row.Status != "paid" || !row.RefundRequired || ps.stock(t, variantID) != stockBefore+1 {
			t.Fatalf("iteration %d: closed first, but payment %+v, stock %d → %d; want paid, flagged, 1 unit back",
				i, row, stockBefore, ps.stock(t, variantID))
		}
		ps.assertEvents(t, o.ID, "order.created", "order.cancelled")
		tally["closed first"]++
	default:
		t.Fatalf("iteration %d: notification %s, order %s, closed %v; want exactly one of them to win",
			i, describe(notifyResp), status, closed)
	}
	want := map[bool]string{false: "paid", true: "refund_required"}[closed]
	if events := ps.paymentEvents(t, paymentID); len(events) != 1 || events[0] != "webhook:settlement:"+want {
		t.Fatalf("iteration %d: payment events %v, want one webhook:settlement:%s", i, events, want)
	}
}

// TestRace_SettlementVersusClose: Midtrans' settlement notification
// arrives at the moment the order closes, by the expiry job, the buyer's
// cancel, an account deletion, or the seller's cancel (rotating). Exactly
// one wins: paid (and the close is refused or finds nothing to do), or
// closed with its stock back and the money flagged for a refund. The
// order is never both.
func TestRace_SettlementVersusClose(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-balap-bayar", variant("BB2-M", "M", 25000, 100000))
	v := p.Variants["BB2-M"]
	closes := []string{"expiry", "buyer cancel", "account deletion"}
	tally := map[string]int{}
	for i := range raceIterations {
		kind := closes[i%len(closes)]
		b := ps.buyer(t, fmt.Sprintf("balap-bayar-%d", i))
		o, pay, poid := ps.paid(t, b, line{v, 1})
		n := ps.notification(t, poid, "settlement", "")
		if kind == "expiry" {
			ps.expireNow(t, o.ID)
		}
		stock := ps.stock(t, v)
		var expired int
		var expireErr error
		results := runTogether(t,
			func() (response, error) { return ps.tryNotify(n) },
			func() (response, error) {
				switch kind {
				case "expiry":
					expired, expireErr = ps.orders().ExpireDue(context.Background())
					return response{Status: http.StatusOK}, nil
				case "buyer cancel":
					return ps.tryCall(http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token, nil)
				default:
					return ps.tryCall(http.MethodDelete, "/v1/me", nil, b.Token, nil)
				}
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d (%s)", i, kind), results...)
		if expireErr != nil {
			t.Fatalf("iteration %d: ExpireDue: %v", i, expireErr)
		}
		var closed bool
		switch kind {
		case "expiry":
			closed = expired == 1
		case "buyer cancel":
			closed = results[1].Status == http.StatusOK
			if !closed {
				assertTransitionRefused(t, results[1], "paid", "cancelled")
			}
		default:
			if results[1].Status != http.StatusNoContent {
				t.Fatalf("iteration %d: DELETE /v1/me = %s", i, describe(results[1]))
			}
			closed = ps.orderStatus(t, o.ID) == "cancelled"
		}
		ps.assertSettledOrClosed(t, i, results[0], o, pay.ID, closed, v, stock, tally)
		if ps.openPayments(t, o.ID) != 0 {
			t.Fatalf("iteration %d: an open payment is left", i)
		}
		tally[kind]++
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, ps.server)
}

// TestRace_ExpireNotificationVersusAdminSave: Midtrans' expire
// notification cancels the unpaid order and returns its stock (order →
// payment → variants in id order) while a seller saves the product with
// its variants in reverse id order. No deadlock; the stock is exact
// either way: the save's value plus the order's units when the save came
// first, the original stock when the expiry did (the save then 409).
func TestRace_ExpireNotificationVersusAdminSave(t *testing.T) {
	ps := newPayShop(t, nil)
	tally := map[string]int{}
	for i := range raceIterations {
		p := ps.product(t, fmt.Sprintf("kaos-kedaluwarsa-admin-%d", i), variant(fmt.Sprintf("KA-%d-M", i), "M", 10000, 40),
			variant(fmt.Sprintf("KA-%d-L", i), "L", 10000, 40))
		m, l := p.Variants[fmt.Sprintf("KA-%d-M", i)], p.Variants[fmt.Sprintf("KA-%d-L", i)]
		b := ps.buyer(t, fmt.Sprintf("kedaluwarsa-admin-%d", i))
		o, pay, poid := ps.paid(t, b, line{m, 2}, line{l, 3})
		n := ps.notification(t, poid, "expire", "")
		save := reverseSave(t, ps.adminForm(t, p.ID), 100, "")
		delay := time.Duration(i%5) * 3 * time.Millisecond
		results := runTogether(t,
			func() (response, error) { return ps.tryNotify(n) },
			func() (response, error) { time.Sleep(delay); return ps.trySave(p.ID, save) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		assertOutcome(t, results[0], "order_cancelled", "expire notification")
		var wantM, wantL int
		switch {
		case results[1].Status == http.StatusOK:
			wantM, wantL = 100+2, 100+3
			tally["save first"]++
		case is(results[1], http.StatusConflict, "VERSION_CONFLICT"):
			wantM, wantL = 40, 40
			tally["expiry first"]++
		default:
			t.Fatalf("iteration %d: save = %s", i, describe(results[1]))
		}
		if ps.stock(t, m) != wantM || ps.stock(t, l) != wantL {
			t.Fatalf("iteration %d: stock M %d L %d, want %d and %d", i, ps.stock(t, m), ps.stock(t, l), wantM, wantL)
		}
		if ps.orderStatus(t, o.ID) != "cancelled" || ps.paymentRow(t, pay.ID).Status != "expired" {
			t.Fatalf("iteration %d: order %s, payment %s", i, ps.orderStatus(t, o.ID), ps.paymentRow(t, pay.ID).Status)
		}
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, ps.server)
}

// TestRace_TwoNotificationsAndADuplicate: Midtrans sends the old pending
// notification, the settlement and the settlement again, all at once.
// Each makes GoShop read the current status (settlement), so all three
// apply the same event: one is paid, two are duplicates, and the order
// is paid once with one order.paid.
func TestRace_TwoNotificationsAndADuplicate(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-tiga-kabar", variant("TK-M", "M", 25000, 100000))
	b := ps.buyer(t, "tiga-kabar")
	for i := range raceIterations {
		o, pay, poid := ps.paid(t, b, line{p.Variants["TK-M"], 1})
		pending := ps.notification(t, poid, "pending", "")
		settled := ps.notification(t, poid, "settlement", "")
		results := runTogether(t,
			func() (response, error) { return ps.tryNotify(pending) },
			func() (response, error) { return ps.tryNotify(settled) },
			func() (response, error) { return ps.tryNotify(settled) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		outcomes := map[string]int{}
		for _, r := range results {
			if r.Status != http.StatusOK {
				t.Fatalf("iteration %d: %s", i, describe(r))
			}
			outcomes[string(decodeObject(t, decodeObject(t, r.Body)["data"])["outcome"])]++
		}
		if outcomes[`"paid"`] != 1 || outcomes[`"duplicate"`] != 2 {
			t.Fatalf("iteration %d: outcomes %v, want one paid and two duplicates", i, outcomes)
		}
		if ps.orderStatus(t, o.ID) != "paid" || ps.paymentRow(t, pay.ID).Status != "paid" || len(ps.paymentEvents(t, pay.ID)) != 1 {
			t.Fatalf("iteration %d: order %s, events %v", i, ps.orderStatus(t, o.ID), ps.paymentEvents(t, pay.ID))
		}
		ps.assertEvents(t, o.ID, "order.created", "order.paid")
	}
	assertNoServerErrors(t, ps.server)
}

// TestRace_ReconcileVersusWebhook: the reconciler asks about a payment at
// the moment its (late) settlement notification arrives. Both apply the
// same status; one records it and pays the order, the other is a
// duplicate. The payment is marked finally checked either way.
func TestRace_ReconcileVersusWebhook(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-rekon-balap", variant("RB-M", "M", 25000, 100000))
	b := ps.buyer(t, "rekon-balap")
	tally := map[string]int{}
	for i := range raceIterations {
		o, pay, poid := ps.paid(t, b, line{p.Variants["RB-M"], 1})
		n := ps.notification(t, poid, "settlement", "")
		ps.agePayment(t, pay.ID, 2*time.Minute)
		var res payment.ReconcileResult
		var recErr error
		results := runTogether(t,
			func() (response, error) { return ps.tryNotify(n) },
			func() (response, error) {
				res, recErr = ps.reconciler(ps.gw).Reconcile(context.Background())
				return response{Status: http.StatusOK}, nil
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if recErr != nil || res.Failed != 0 {
			t.Fatalf("iteration %d: Reconcile = %+v, %v", i, res, recErr)
		}
		events := ps.paymentEvents(t, pay.ID)
		switch {
		case len(events) == 1 && events[0] == "webhook:settlement:paid" && res.Changed == 0:
			assertOutcome(t, results[0], "paid", "webhook")
			tally["webhook"]++
		case len(events) == 1 && events[0] == "reconcile:settlement:paid" && res.Changed == 1:
			assertOutcome(t, results[0], "duplicate", "webhook")
			tally["reconcile"]++
		case len(events) == 1 && events[0] == "webhook:settlement:paid" && res.Checked == 0:
			// The webhook committed before the reconciler listed the queue.
			tally["webhook before the listing"]++
		default:
			t.Fatalf("iteration %d: events %v, reconcile %+v, webhook %s", i, events, res, describe(results[0]))
		}
		if ps.orderStatus(t, o.ID) != "paid" {
			t.Fatalf("iteration %d: order %s", i, ps.orderStatus(t, o.ID))
		}
		ps.assertEvents(t, o.ID, "order.created", "order.paid")
	}
	t.Logf("who paid over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, ps.server)
}

// slowGateway is the fake gateway whose CreateTransaction takes delay,
// so a pay's Midtrans call (outside any transaction) overlaps whatever
// races it.
type slowGateway struct {
	*fake.Gateway
	delay func() time.Duration
}

func (g slowGateway) CreateTransaction(ctx context.Context, req payment.TransactionRequest) (payment.Transaction, error) {
	time.Sleep(g.delay())
	return g.Gateway.CreateTransaction(ctx, req)
}

// TestRace_TwoPayCalls: a double tap sends two pay calls at once. Both
// call the gateway; the partial unique index lets one insert win, and the
// other answers the winner's payment: one 201 and one 200 with the same
// payment, and exactly one open payment.
func TestRace_TwoPayCalls(t *testing.T) {
	ps := newPayShop(t, nil)
	p := ps.product(t, "kaos-dua-bayar", variant("DB-M", "M", 25000, 100000))
	b := ps.buyer(t, "dua-bayar")
	for i := range raceIterations {
		o := ps.order(t, b, line{p.Variants["DB-M"], 1})
		results := runTogether(t,
			func() (response, error) { return ps.tryPay(b.Token, o.ID) },
			func() (response, error) { return ps.tryPay(b.Token, o.ID) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		counts := statusCounts(t, results)
		if counts["201"] != 1 || counts["200"] != 1 {
			t.Fatalf("iteration %d: %v, want one 201 and one 200", i, counts)
		}
		a := assertPaymentSession(t, results[0], results[0].Status, "pay")
		c := assertPaymentSession(t, results[1], results[1].Status, "pay")
		if a.ID != c.ID || a.Token != c.Token {
			t.Fatalf("iteration %d: two payments answered: %s and %s", i, a.ID, c.ID)
		}
		if n := ps.count(t, `SELECT count(*) FROM payments WHERE order_id = $1`, o.ID); n != 1 {
			t.Fatalf("iteration %d: %d payments stored", i, n)
		}
		assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	}
	assertNoServerErrors(t, ps.server)
}

// TestRace_PayVersusClose: the buyer starts paying at the moment the
// order closes (the buyer's own cancel from another tab, the expiry job,
// an account deletion), while the pay's gateway call takes 0 to 12 ms.
// The insert reads the order FOR SHARE and a close locks the order first,
// so either the pay stored its payment before the close (which then
// cancelled it) or it found the order closed (409): no open payment is
// ever left on a closed order.
func TestRace_PayVersusClose(t *testing.T) {
	var iteration atomic.Int64
	gw := slowGateway{Gateway: fake.New(fake.NewMemoryStore()), delay: func() time.Duration {
		return time.Duration(iteration.Load()%5) * 3 * time.Millisecond
	}}
	sh := newShop(t, nil, app.WithPaymentGateway(gw))
	p := sh.product(t, "kaos-bayar-tutup", variant("BT-M", "M", 25000, 100000))
	v := p.Variants["BT-M"]
	closes := []string{"buyer cancel", "expiry", "account deletion"}
	tally := map[string]int{}
	for i := range raceIterations {
		iteration.Store(int64(i))
		kind := closes[i%len(closes)]
		b := sh.buyer(t, fmt.Sprintf("bayar-tutup-%d", i))
		o := sh.order(t, b, line{v, 1})
		if kind == "expiry" {
			// Three minutes left for the pay; past the job's deadline.
			mustExec(t, sh.db, `UPDATE orders SET payment_expires_at = $2 WHERE id = $1`, o.ID, time.Now().Add(3*time.Minute))
		}
		stock := sh.stock(t, v)
		var expireErr error
		results := runTogether(t,
			func() (response, error) { return sh.tryPay(b.Token, o.ID) },
			func() (response, error) {
				switch kind {
				case "buyer cancel":
					return sh.tryCall(http.MethodPost, "/v1/orders/"+o.ID+"/cancel", nil, b.Token, nil)
				case "expiry":
					// The job runs with a clock past the deadline.
					svc := sh.orders()
					_, err := expireAt(context.Background(), sh, svc, o.ID)
					expireErr = err
					return response{Status: http.StatusOK}, nil
				default:
					return sh.tryCall(http.MethodDelete, "/v1/me", nil, b.Token, nil)
				}
			})
		assertNo5xx(t, fmt.Sprintf("iteration %d (%s)", i, kind), results...)
		if expireErr != nil {
			t.Fatalf("iteration %d: expiry: %v", i, expireErr)
		}
		if sh.orderStatus(t, o.ID) != "cancelled" || sh.stock(t, v) != stock+1 {
			t.Fatalf("iteration %d (%s): order %s, stock %d → %d; want cancelled with its unit back",
				i, kind, sh.orderStatus(t, o.ID), stock, sh.stock(t, v))
		}
		if n := sh.openPayments(t, o.ID); n != 0 {
			t.Fatalf("iteration %d (%s): %d open payments on a cancelled order (pay %s)", i, kind, n, describe(results[0]))
		}
		switch {
		case results[0].Status == http.StatusCreated || results[0].Status == http.StatusOK:
			if n := sh.count(t, `SELECT count(*) FROM payments WHERE order_id = $1 AND status = 'cancelled'`, o.ID); n != 1 {
				t.Fatalf("iteration %d: pay %s, but %d cancelled payments", i, describe(results[0]), n)
			}
			tally["paid then closed"]++
		case is(results[0], http.StatusConflict, "INVALID_TRANSITION"), is(results[0], http.StatusUnauthorized, "UNAUTHORIZED"),
			// The expiry moved the deadline before the pay read the order.
			is(results[0], http.StatusConflict, "PAYMENT_WINDOW_CLOSED"),
			is(results[0], http.StatusNotFound, "NOT_FOUND"):
			if n := sh.count(t, `SELECT count(*) FROM payments WHERE order_id = $1`, o.ID); n != 0 {
				t.Fatalf("iteration %d: pay %s, but %d payments stored", i, describe(results[0]), n)
			}
			tally["closed first: "+fmt.Sprint(results[0].Status)]++
		default:
			t.Fatalf("iteration %d: pay %s", i, describe(results[0]))
		}
	}
	t.Logf("over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// expireAt runs the expiry job for orderID as it will run once the
// order's deadline has passed: the deadline is moved into the past in the
// same moment, so the pay (which read the order before) races the job.
func expireAt(ctx context.Context, sh *shop, svc interface {
	ExpireDue(context.Context) (int, error)
}, orderID string,
) (int, error) {
	if _, err := sh.db.ExecContext(ctx, `UPDATE orders SET payment_expires_at = now() - interval '1 second' WHERE id = $1`, orderID); err != nil {
		return 0, err
	}
	return svc.ExpireDue(ctx)
}
