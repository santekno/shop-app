package order

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/cart"
	"github.com/santekno/shop-app/apps/api/internal/shipping"
)

func TestNewService_Defaults(t *testing.T) {
	repo := &fakeRepo{claim: claimResult{claimed: true}}
	svc := NewService(Deps{
		Repo: repo, Carts: &fakeCarts{cart: cart.Cart{Lines: []cart.Line{line(v1, 1, 1000, 5)}}},
		Addresses: &fakeAddresses{}, Shipping: &fakeProvider{},
	})
	before := time.Now()
	_, err := svc.Checkout(context.Background(), buyerID, Idempotency{Key: "k"}, CheckoutInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "REG"})
	testx.AssertNoError(t, err)
	in := repo.placed[0]
	testx.AssertEqual(t, in.PaymentTTL, DefaultPaymentTTL, "24 hours without APP_PAYMENT_TTL")
	testx.AssertTrue(t, !in.Now.Before(before) && time.Since(in.Now) < time.Minute, "the real clock without Clock: %v", in.Now)
}

func TestService_Preview(t *testing.T) {
	t.Run("the cart only", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 50000, 5), line(v2, 1, 15000, 5))
		p, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, p.Totals, Totals{Subtotal: 115000, Total: 115000, WeightGrams: 750})
		testx.AssertTrue(t, p.Shipping == nil && p.Voucher == nil)
		testx.AssertEqual(t, len(p.Lines), 2)
		testx.AssertEqual(t, len(env.provider.requests), 0, "no courier is asked before one is chosen")
		testx.AssertEqual(t, len(env.addresses.asked), 0)
		testx.AssertEqual(t, env.carts.owners[0], cart.Owner{UserID: buyerID}, "the buyer's own cart")
	})
	t.Run("with an address only: checked, not priced", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 50000, 5))
		p, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{AddressID: addressID})
		testx.AssertNoError(t, err)
		testx.AssertTrue(t, p.Shipping == nil)
		testx.AssertEqual(t, p.Totals.ShippingFee, int64(0))
		testx.AssertEqual(t, len(env.addresses.asked), 1)
		testx.AssertEqual(t, len(env.provider.requests), 0)
	})
	t.Run("with a courier service: the provider's fee", func(t *testing.T) {
		env := newServiceEnv(line(v1, 5, 50000, 5)) // 1250 g: 2 kg
		p, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "YES"})
		testx.AssertNoError(t, err)
		if p.Shipping == nil {
			t.Fatal("no shipping quote")
		}
		testx.AssertEqual(t, p.Shipping.Price, int64(36000))
		testx.AssertEqual(t, p.Totals, Totals{Subtotal: 250000, ShippingFee: 36000, Total: 286000, WeightGrams: 1250})
		testx.AssertEqual(t, env.provider.requests[0], shipping.Request{
			OriginPostalCode: "40115", DestinationPostalCode: "40111", WeightGrams: 1250, Value: 250000,
		})
	})
	t.Run("with a voucher: checked at the clock on the goods' subtotal", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 60000, 5))
		env.repo.voucher = hemat10()
		p, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{
			AddressID: addressID, Courier: shipping.CourierSiCepat, Service: "REG", VoucherCode: "HEMAT10",
		})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, strings.Join(env.repo.calls, ","), "VoucherByCode HEMAT10,VoucherUses "+voucherID+" "+buyerID)
		if p.Voucher == nil {
			t.Fatal("no voucher applied")
		}
		testx.AssertEqual(t, p.Voucher.Code, "HEMAT10")
		// 10% of 120000 = 12000; shipping (SiCepat REG, 1 kg) is not discounted.
		testx.AssertEqual(t, p.Totals, Totals{Subtotal: 120000, Discount: 12000, ShippingFee: 9000, Total: 117000, WeightGrams: 500})
	})
	t.Run("the voucher's minimum is on the goods, not the shipping fee", func(t *testing.T) {
		env := newServiceEnv(line(v1, 1, 95000, 5))
		env.repo.voucher = hemat10()
		_, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "YES", VoucherCode: "HEMAT10"})
		var ve *VoucherError
		testx.AssertTrue(t, errors.As(err, &ve), "err = %v", err)
		testx.AssertEqual(t, ve.Reason, VoucherMinSpend)
	})
	t.Run("a voucher the buyer used already", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 60000, 5))
		env.repo.voucher, env.repo.uses = hemat10(), 1
		_, err := env.svc.Preview(context.Background(), buyerID, PreviewInput{VoucherCode: "HEMAT10"})
		var ve *VoucherError
		testx.AssertTrue(t, errors.As(err, &ve), "err = %v", err)
		testx.AssertEqual(t, ve.Reason, VoucherPerUserLimit)
	})

	refusals := []struct {
		name  string
		lines []cart.Line
		edit  func(env *serviceEnv)
		in    PreviewInput
		check func(t *testing.T, err error)
	}{
		{name: "empty cart", check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrCartEmpty)) }},
		{name: "cart read fails", lines: []cart.Line{line(v1, 1, 1, 1)}, edit: func(env *serviceEnv) { env.carts.err = errBoom },
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "read cart: boom") }},
		{name: "a line with a problem", lines: []cart.Line{line(v1, 9, 1, 1)},
			check: func(t *testing.T, err error) {
				var p *ProblemsError
				testx.AssertTrue(t, errors.As(err, &p))
				testx.AssertEqual(t, p.Lines[0].Problem, cart.ProblemInsufficientStock)
			}},
		{name: "another user's address", lines: []cart.Line{line(v1, 1, 1, 1)}, in: PreviewInput{AddressID: "0190c8a0-0000-7000-8000-0000000000e9"},
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrUnknownAddress)) }},
		{name: "address read fails", lines: []cart.Line{line(v1, 1, 1, 1)}, edit: func(env *serviceEnv) { env.addresses.err = errBoom },
			in: PreviewInput{AddressID: addressID}, check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "read address: boom") }},
		{name: "a service the courier does not offer", lines: []cart.Line{line(v1, 1, 1, 1)},
			in:    PreviewInput{AddressID: addressID, Courier: shipping.CourierJNT, Service: "REG"},
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrUnknownShippingService)) }},
		{name: "the provider is down", lines: []cart.Line{line(v1, 1, 1, 1)},
			edit: func(env *serviceEnv) { env.provider.err = shipping.ErrUnavailable },
			in:   PreviewInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "REG"},
			check: func(t *testing.T, err error) {
				testx.AssertTrue(t, errors.Is(err, shipping.ErrUnavailable))
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), "quote shipping: "), "err = %v", err)
			}},
		{name: "unknown voucher", lines: []cart.Line{line(v1, 1, 1, 1)},
			edit: func(env *serviceEnv) { env.repo.voucherErr = &VoucherError{Code: "NOPE", Reason: VoucherNotFound} },
			in:   PreviewInput{VoucherCode: "NOPE"},
			check: func(t *testing.T, err error) {
				var ve *VoucherError
				testx.AssertTrue(t, errors.As(err, &ve))
				testx.AssertEqual(t, ve.Reason, VoucherNotFound)
			}},
		{name: "voucher uses fail", lines: []cart.Line{line(v1, 1, 1, 1)},
			edit:  func(env *serviceEnv) { env.repo.voucher, env.repo.usesErr = hemat10(), errBoom },
			in:    PreviewInput{VoucherCode: "HEMAT10"},
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "preview checkout: boom") }},
	}
	for _, tt := range refusals {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(tt.lines...)
			if tt.edit != nil {
				tt.edit(env)
			}
			p, err := env.svc.Preview(context.Background(), buyerID, tt.in)
			testx.AssertError(t, err)
			tt.check(t, err)
			testx.AssertTrue(t, p.Shipping == nil && p.Voucher == nil && len(p.Lines) == 0, "an error returns no preview")
		})
	}
}

func TestService_ShippingQuotes(t *testing.T) {
	unsellable := line(v2, 1, 1000, 0)
	unsellable.Sellable = false
	env := newServiceEnv(line(v1, 4, 25000, 9), unsellable) // 1250 g
	q, err := env.svc.ShippingQuotes(context.Background(), buyerID, addressID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, q.WeightGrams, int64(1250), "lines with problems still count")
	testx.AssertEqual(t, len(q.Quotes), 5)
	testx.AssertEqual(t, q.Quotes[0].Price, int64(18000), "SiCepat REG, 2 kg, cheapest first")
	testx.AssertEqual(t, env.provider.requests[0], shipping.Request{
		OriginPostalCode: "40115", DestinationPostalCode: "40111", WeightGrams: 1250, Value: 101000,
	})

	tests := []struct {
		name  string
		lines []cart.Line
		edit  func(env *serviceEnv)
		addr  string
		check func(t *testing.T, err error)
	}{
		{name: "empty cart", addr: addressID, check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrCartEmpty)) }},
		{name: "cart read fails", addr: addressID, edit: func(env *serviceEnv) { env.carts.err = errBoom },
			check: func(t *testing.T, err error) { testx.AssertEqual(t, err.Error(), "shipping quotes: boom") }},
		{name: "unknown address", lines: []cart.Line{line(v1, 1, 1, 1)}, addr: v1,
			check: func(t *testing.T, err error) { testx.AssertTrue(t, errors.Is(err, ErrUnknownAddress)) }},
		{name: "provider down", lines: []cart.Line{line(v1, 1, 1, 1)}, addr: addressID,
			edit: func(env *serviceEnv) { env.provider.err = shipping.ErrUnavailable },
			check: func(t *testing.T, err error) {
				testx.AssertTrue(t, errors.Is(err, shipping.ErrUnavailable))
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), "shipping quotes: "))
			}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv(tt.lines...)
			if tt.edit != nil {
				tt.edit(env)
			}
			q, err := env.svc.ShippingQuotes(context.Background(), buyerID, tt.addr)
			tt.check(t, err)
			testx.AssertEqual(t, len(q.Quotes), 0)
		})
	}
}

func checkoutIn() CheckoutInput {
	return CheckoutInput{AddressID: addressID, Courier: shipping.CourierJNE, Service: "REG", VoucherCode: "HEMAT10"}
}

func TestService_Checkout(t *testing.T) {
	idem := Idempotency{Key: "key-1", RequestHash: []byte{1, 2, 3}}

	t.Run("a claimed key places the order", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 60000, 5), line(v2, 1, 10000, 5))
		env.repo.claim = claimResult{claimed: true}
		env.repo.placeOut = Response{Status: 201, Body: []byte(`{"data":{}}`), OrderID: orderID1}
		resp, err := env.svc.Checkout(context.Background(), buyerID, idem, checkoutIn())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, resp.OrderID, orderID1)
		testx.AssertEqual(t, strings.Join(env.repo.calls, ","), "ClaimKey "+buyerID+",Place", "the key is claimed first and kept")
		testx.AssertEqual(t, env.repo.claimIdem.Key, "key-1")
		testx.AssertTrue(t, env.repo.claimNow.Equal(testTime))
		in := env.repo.placed[0]
		testx.AssertEqual(t, in.UserID, buyerID)
		testx.AssertEqual(t, len(in.Lines), 2)
		testx.AssertEqual(t, in.WeightGrams, int64(750))
		testx.AssertEqual(t, in.Shipping.Courier, shipping.CourierJNE)
		testx.AssertEqual(t, in.Shipping.Service, "REG")
		testx.AssertEqual(t, in.Shipping.Price, int64(10000), "the fee comes from the provider")
		testx.AssertEqual(t, in.VoucherCode, "HEMAT10")
		testx.AssertEqual(t, in.IdempotencyKey, "key-1")
		testx.AssertEqual(t, in.PaymentTTL, time.Hour)
		testx.AssertTrue(t, in.Now.Equal(testTime))
		testx.AssertEqual(t, in.Address, ShippingAddress{
			Recipient: "Budi", Phone: "081234567890", Street: "Jl. Merdeka 1", City: "Bandung", Province: "Jawa Barat", PostalCode: "40111",
		})
		testx.AssertEqual(t, len(env.provider.requests), 1, "one quote, before the transaction")
	})
	t.Run("a finished key replays its answer and checks out nothing", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 60000, 5))
		stored := &Response{Status: 201, Body: []byte(`{"data":{"id":"x"}}`), OrderID: orderID1, Replayed: true}
		env.repo.claim = claimResult{replay: stored}
		resp, err := env.svc.Checkout(context.Background(), buyerID, idem, checkoutIn())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, string(resp.Body), `{"data":{"id":"x"}}`)
		testx.AssertTrue(t, resp.Replayed)
		testx.AssertEqual(t, strings.Join(env.repo.calls, ","), "ClaimKey "+buyerID)
		testx.AssertEqual(t, len(env.carts.owners), 0)
		testx.AssertEqual(t, len(env.provider.requests), 0)
	})
	for _, claimErr := range []error{ErrIdempotencyKeyReused, ErrIdempotencyInProgress, errBoom} {
		t.Run("a refused claim: "+claimErr.Error(), func(t *testing.T) {
			env := newServiceEnv(line(v1, 2, 60000, 5))
			env.repo.claimErr = claimErr
			_, err := env.svc.Checkout(context.Background(), buyerID, idem, checkoutIn())
			testx.AssertTrue(t, errors.Is(err, claimErr))
			testx.AssertEqual(t, len(env.repo.released), 0, "a key that is not ours is never released")
			testx.AssertEqual(t, len(env.repo.placed), 0)
		})
	}
	t.Run("a failed checkout releases its key, even after the client hung up", func(t *testing.T) {
		env := newServiceEnv() // empty cart
		env.repo.claim = claimResult{claimed: true}
		type ctxKey struct{}
		ctx, cancel := context.WithCancel(context.WithValue(context.Background(), ctxKey{}, "request"))
		cancel()
		_, err := env.svc.Checkout(ctx, buyerID, idem, checkoutIn())
		testx.AssertTrue(t, errors.Is(err, ErrCartEmpty), "the checkout's own error: %v", err)
		testx.AssertEqual(t, strings.Join(env.repo.released, ","), "key-1")
		testx.AssertNoError(t, env.repo.releaseCtx.Err(), "the release does not inherit the cancellation")
		testx.AssertEqual(t, env.repo.releaseCtx.Value(ctxKey{}), any("request"), "but keeps the request's values")
	})
	t.Run("a failed Place is wrapped and releases the key", func(t *testing.T) {
		env := newServiceEnv(line(v1, 2, 60000, 5))
		env.repo.claim, env.repo.placeErr = claimResult{claimed: true}, ErrTooManyPendingOrders
		_, err := env.svc.Checkout(context.Background(), buyerID, idem, checkoutIn())
		testx.AssertTrue(t, errors.Is(err, ErrTooManyPendingOrders))
		testx.AssertEqual(t, err.Error(), "checkout: too many pending orders")
		testx.AssertEqual(t, len(env.repo.released), 1)
	})
	t.Run("an unknown address and an unknown service release the key", func(t *testing.T) {
		for _, in := range []CheckoutInput{
			{AddressID: v1, Courier: shipping.CourierJNE, Service: "REG"},
			{AddressID: addressID, Courier: shipping.CourierJNE, Service: "EZ"},
		} {
			env := newServiceEnv(line(v1, 2, 60000, 5))
			env.repo.claim = claimResult{claimed: true}
			_, err := env.svc.Checkout(context.Background(), buyerID, idem, in)
			testx.AssertTrue(t, errors.Is(err, ErrUnknownAddress) || errors.Is(err, ErrUnknownShippingService), "err = %v", err)
			testx.AssertEqual(t, len(env.repo.released), 1)
			testx.AssertEqual(t, len(env.repo.placed), 0)
		}
	})
	t.Run("a release that fails is reported with the cause", func(t *testing.T) {
		env := newServiceEnv(line(v1, 9, 60000, 5)) // a stock problem
		env.repo.claim, env.repo.releaseErr = claimResult{claimed: true}, errBoom
		_, err := env.svc.Checkout(context.Background(), buyerID, idem, checkoutIn())
		var p *ProblemsError
		testx.AssertTrue(t, errors.As(err, &p), "the cause is kept: %v", err)
		testx.AssertTrue(t, errors.Is(err, errBoom), "and the release error: %v", err)
	})
}

func TestService_ExpireDue(t *testing.T) {
	batch := func(n int, prefix string) []string {
		ids := make([]string, n)
		for i := range ids {
			ids[i] = prefix
		}
		return ids
	}
	t.Run("in batches, until a short one", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.expired = [][]string{batch(ExpireBatchSize, "a"), batch(3, "b")}
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, ExpireBatchSize+3)
		testx.AssertEqual(t, len(env.repo.expiredAt), 2)
		for _, at := range env.repo.expiredAt {
			testx.AssertTrue(t, at.Equal(testTime), "one deadline for the whole run")
		}
		c := env.repo.changes[0]
		testx.AssertEqual(t, c.To, StatusCancelled)
		testx.AssertEqual(t, c.CancelReason, CancelPaymentExpired)
		testx.AssertEqual(t, c.BuyerID, "")
		testx.AssertTrue(t, c.Now.Equal(testTime))
	})
	t.Run("a full last batch reads once more", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.expired = [][]string{batch(ExpireBatchSize, "a")}
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, ExpireBatchSize)
		testx.AssertEqual(t, len(env.repo.expiredAt), 2)
	})
	t.Run("nothing due", func(t *testing.T) {
		env := newServiceEnv()
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 0)
		testx.AssertEqual(t, len(env.repo.changes), 0)
	})
	t.Run("an order paid since it was listed is skipped, not counted", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.expired = [][]string{{"a", "paid", "c"}}
		env.repo.transitionErr = func(c Change) error {
			if c.OrderID == "paid" {
				return &TransitionError{Current: StatusPaid, To: StatusCancelled}
			}
			return nil
		}
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, n, 2)
		testx.AssertEqual(t, len(env.repo.changes), 3, "the rest still run")
	})
	t.Run("another error stops the run with the count so far", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.expired = [][]string{{"a", "bad", "c"}}
		env.repo.transitionErr = func(c Change) error {
			if c.OrderID == "bad" {
				return errBoom
			}
			return nil
		}
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, err.Error(), "expire order bad: boom")
		testx.AssertEqual(t, n, 1)
		testx.AssertEqual(t, len(env.repo.changes), 2)
	})
	t.Run("listing fails", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.expiredErr = errBoom
		n, err := env.svc.ExpireDue(context.Background())
		testx.AssertTrue(t, errors.Is(err, errBoom))
		testx.AssertEqual(t, n, 0)
	})
}

func TestService_CleanupKeys(t *testing.T) {
	env := newServiceEnv()
	env.repo.deleted = []int64{KeyCleanupBatch, KeyCleanupBatch, 7}
	n, err := env.svc.CleanupKeys(context.Background())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(2*KeyCleanupBatch+7))
	testx.AssertEqual(t, len(env.repo.deleteNows), 3, "until a batch is not full")
	for _, at := range env.repo.deleteNows {
		testx.AssertTrue(t, at.Equal(testTime), "one cut-off for the whole run")
	}

	env = newServiceEnv()
	env.repo.deleted = []int64{KeyCleanupBatch}
	n, err = env.svc.CleanupKeys(context.Background())
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, n, int64(KeyCleanupBatch))
	testx.AssertEqual(t, len(env.repo.deleteNows), 2, "a full batch reads once more")

	env = newServiceEnv()
	env.repo.deleted, env.repo.deleteErr = []int64{KeyCleanupBatch, 3}, errBoom
	n, err = env.svc.CleanupKeys(context.Background())
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertEqual(t, n, int64(KeyCleanupBatch+3), "what was deleted is still counted")
}

func TestService_QueueAndHistory(t *testing.T) {
	for _, limit := range []int{0, -1, MaxPageSize + 1} {
		env := newServiceEnv()
		_, err := env.svc.Queue(context.Background(), StatusPaid, "", limit)
		testx.AssertEqual(t, err.Error(), "order queue: limit "+strconv.Itoa(limit)+" out of range")
		_, err = env.svc.History(context.Background(), buyerID, "", limit)
		testx.AssertEqual(t, err.Error(), "order history: limit "+strconv.Itoa(limit)+" out of range")
		testx.AssertEqual(t, len(env.repo.calls), 0)
	}

	t.Run("the queue reads one more than a page, from the first page", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.listOut = []Order{{ID: orderID1, CreatedAt: testTime}, {ID: v1, CreatedAt: testTime}}
		page, err := env.svc.Queue(context.Background(), StatusProcessing, "", 1)
		testx.AssertNoError(t, err)
		q := env.repo.listStatus[0]
		testx.AssertEqual(t, q, StatusQuery{Status: StatusProcessing, After: firstPage, Limit: 2})
		testx.AssertEqual(t, len(page.Orders), 1)
		// The next cursor belongs to this status's list only.
		_, err = decodeCursor("status:processing", page.NextCursor)
		testx.AssertNoError(t, err)
		_, err = env.svc.Queue(context.Background(), StatusPaid, page.NextCursor, 1)
		testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor))
		_, err = env.svc.History(context.Background(), buyerID, page.NextCursor, 1)
		testx.AssertTrue(t, errors.Is(err, ErrInvalidCursor), "a queue cursor is not a history cursor")
	})
	t.Run("history is scoped by the caller", func(t *testing.T) {
		env := newServiceEnv()
		cursor := encodeCursor("mine", Order{ID: orderID1, CreatedAt: testTime})
		_, err := env.svc.History(context.Background(), buyerID, cursor, MaxPageSize)
		testx.AssertNoError(t, err)
		q := env.repo.listHistory[0]
		testx.AssertEqual(t, q.UserID, buyerID)
		testx.AssertEqual(t, q.Limit, MaxPageSize+1)
		testx.AssertEqual(t, q.After.ID, orderID1)
	})
	t.Run("repository errors are wrapped", func(t *testing.T) {
		env := newServiceEnv()
		env.repo.listErr = errBoom
		_, err := env.svc.Queue(context.Background(), StatusPaid, "", 1)
		testx.AssertEqual(t, err.Error(), "order queue: boom")
		_, err = env.svc.History(context.Background(), buyerID, "", 1)
		testx.AssertEqual(t, err.Error(), "order history: boom")
	})
}

func TestService_Get(t *testing.T) {
	env := newServiceEnv()
	o, err := env.svc.Get(context.Background(), buyerID, orderID1)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, o.ID, orderID1)
	testx.AssertEqual(t, env.repo.getUsers[0], buyerID)

	env.repo.getErr = ErrNotFound
	_, err = env.svc.Get(context.Background(), buyerID, orderID1)
	testx.AssertTrue(t, errors.Is(err, ErrNotFound))
	testx.AssertEqual(t, err.Error(), "get order "+orderID1+": order not found")
	_, err = env.svc.GetForStaff(context.Background(), orderID1)
	testx.AssertTrue(t, errors.Is(err, ErrNotFound))
	testx.AssertEqual(t, err.Error(), "get order "+orderID1+": order not found")

	env.repo.getErr = nil
	o, err = env.svc.GetForStaff(context.Background(), orderID1)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, o.ID, orderID1)
}

// Each move of the life cycle is one Change with the right fields; the
// buyer's moves are scoped to the buyer, the staff's are not.
func TestService_Moves(t *testing.T) {
	tests := []struct {
		name string
		move func(s *Service) error
		want Change
	}{
		{name: "paid", move: func(s *Service) error { return s.MarkPaid(context.Background(), orderID1) },
			want: Change{OrderID: orderID1, To: StatusPaid, Now: testTime}},
		{name: "processing", move: func(s *Service) error { return s.StartProcessing(context.Background(), orderID1) },
			want: Change{OrderID: orderID1, To: StatusProcessing, Now: testTime}},
		{name: "shipped", move: func(s *Service) error { return s.Ship(context.Background(), orderID1, "JNE123456") },
			want: Change{OrderID: orderID1, To: StatusShipped, Now: testTime, TrackingNumber: "JNE123456"}},
		{name: "completed by the buyer", move: func(s *Service) error { return s.Complete(context.Background(), buyerID, orderID1) },
			want: Change{OrderID: orderID1, To: StatusCompleted, Now: testTime, BuyerID: buyerID}},
		{name: "completed by staff", move: func(s *Service) error { return s.Complete(context.Background(), "", orderID1) },
			want: Change{OrderID: orderID1, To: StatusCompleted, Now: testTime}},
		{name: "cancelled by the buyer", move: func(s *Service) error { return s.CancelByBuyer(context.Background(), buyerID, orderID1) },
			want: Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, BuyerID: buyerID, CancelReason: CancelBuyerCancelled}},
		{name: "cancelled by the seller", move: func(s *Service) error { return s.CancelBySeller(context.Background(), orderID1) },
			want: Change{OrderID: orderID1, To: StatusCancelled, Now: testTime, CancelReason: CancelSellerCancelled}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			env := newServiceEnv()
			testx.AssertNoError(t, tt.move(env.svc))
			testx.AssertEqual(t, len(env.repo.changes), 1)
			testx.AssertEqual(t, env.repo.changes[0], tt.want)

			env.repo.transitionErr = func(Change) error { return &TransitionError{Current: StatusCompleted, To: tt.want.To} }
			err := tt.move(env.svc)
			var te *TransitionError
			testx.AssertTrue(t, errors.As(err, &te), "err = %v", err)
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "order "+orderID1+" to "+string(tt.want.To)+": "), "err = %v", err)
		})
	}
}
