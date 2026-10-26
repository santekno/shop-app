//go:build integration

package integration_test

import (
	"net/http"
	"testing"
	"time"

	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/product"
	"github.com/santekno/shop-app/apps/api/internal/worker"
)

// TestWorker_JobsRunForReal enqueues each scheduled job's task the way
// the scheduler does and lets a real Asynq server run it against the
// test's Redis and PostgreSQL: each one completes, does its work, and
// leaves what it must not touch alone.
func TestWorker_JobsRunForReal(t *testing.T) {
	bucket := testBucket(t)
	ps := newPayShop(t, nil)
	w := startWorker(t, ps.shop, workerOpts{deps: worker.JobDeps{Gateway: ps.gw, Store: bucket}})
	p := ps.product(t, "kaos-pekerja", variant("PK-M", "M", 25000, 100))
	v := p.Variants["PK-M"]
	b := ps.buyer(t, "pekerja")

	t.Run("expire orders", func(t *testing.T) {
		due := ps.order(t, b, line{v, 1})
		live := ps.order(t, b, line{v, 1})
		ps.expireNow(t, due.ID)
		w.run(t, worker.TypeExpireOrders)
		if ps.orderStatus(t, due.ID) != "cancelled" || ps.orderStatus(t, live.ID) != "pending_payment" {
			t.Errorf("orders %s and %s, want the due one cancelled only", ps.orderStatus(t, due.ID), ps.orderStatus(t, live.ID))
		}
		assertOrderDetail(t, ps.call(t, http.MethodPost, "/v1/orders/"+live.ID+"/cancel", nil, b.Token), http.StatusOK, "cancel")
	})

	t.Run("reconcile payments", func(t *testing.T) {
		o, pay, poid := ps.paid(t, b, line{v, 1})
		ps.notification(t, poid, "settlement", "")
		ps.agePayment(t, pay.ID, 2*time.Minute)
		w.run(t, worker.TypeReconcilePayments)
		if ps.orderStatus(t, o.ID) != "paid" {
			t.Errorf("order %s after the reconcile job, want paid", ps.orderStatus(t, o.ID))
		}
	})

	t.Run("process images", func(t *testing.T) {
		img := ps.uploaded(t, p.ID, "image/jpeg", jpegOf(t, 900, 600), "")
		w.run(t, worker.TypeProcessImages)
		if ps.imageStatus(t, img.ID) != product.ImageReady {
			t.Errorf("image %s after the job, want ready", ps.imageStatus(t, img.ID))
		}
	})

	t.Run("cleanup pending uploads", func(t *testing.T) {
		stale := ps.upload(t, p.ID, "image/png", pngOf(t, 50, 50))
		fresh := assertUpload(t, ps.startUpload(t, p.ID, "image/png", 100), "fresh upload").Image
		staleKey := ps.imageKey(t, stale.ID)
		mustExec(t, ps.db, `UPDATE product_images SET created_at = now() - interval '25 hours' WHERE id = $1`, stale.ID)
		w.run(t, worker.TypeCleanupPendingUploads)
		if ps.imageStatus(t, stale.ID) != "" || objectExists(t, staleKey) {
			t.Error("the day-old pending upload or its file is still there")
		}
		if ps.imageStatus(t, fresh.ID) != product.ImagePendingUpload {
			t.Error("a fresh pending upload was deleted")
		}
	})

	t.Run("cleanup idempotency keys", func(t *testing.T) {
		expired, live := uuidx.NewV7(), uuidx.NewV7()
		for key, expiry := range map[string]string{expired: "-1 minute", live: "1 day"} {
			mustExec(t, ps.db, `INSERT INTO idempotency_keys (user_id, key, request_hash, claim_id, created_at, expires_at)
				VALUES ($1, $2, $3, $4, now() - interval '1 day', now() + $5::interval)`,
				b.ID, key, requestHash(b.AddressID, "jne", "REG", ""), uuidx.NewV7(), expiry)
		}
		w.run(t, worker.TypeCleanupIdempotency)
		if ps.count(t, `SELECT count(*) FROM idempotency_keys WHERE key = $1`, expired) != 0 ||
			ps.count(t, `SELECT count(*) FROM idempotency_keys WHERE key = $1`, live) != 1 {
			t.Error("want the expired key deleted and the live one kept")
		}
	})

	t.Run("cleanup refresh tokens", func(t *testing.T) {
		before := ps.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1`, b.ID)
		ps.login(t, b.Email, testPassword)
		mustExec(t, ps.db, `UPDATE refresh_tokens SET expires_at = now() - interval '1 minute'
			WHERE id = (SELECT id FROM refresh_tokens WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1)`, b.ID)
		w.run(t, worker.TypeCleanupRefreshTokens)
		if n := ps.count(t, `SELECT count(*) FROM refresh_tokens WHERE user_id = $1`, b.ID); n != before {
			t.Errorf("%d refresh tokens, want the %d live ones", n, before)
		}
	})

	t.Run("cleanup guest carts", func(t *testing.T) {
		old := ps.addItem(t, "", "", v, 1)
		fresh := ps.addItem(t, "", "", v, 1)
		if old.Status != http.StatusOK && old.Status != http.StatusCreated {
			t.Fatalf("guest add = %s", describe(old))
		}
		oldToken, freshToken := old.Header.Get("X-Cart-Token"), fresh.Header.Get("X-Cart-Token")
		mustExec(t, ps.db, `UPDATE carts SET updated_at = now() - interval '31 days' WHERE user_id IS NULL
			AND id = (SELECT id FROM carts WHERE user_id IS NULL ORDER BY created_at LIMIT 1)`)
		mustExec(t, ps.db, `UPDATE cart_items SET updated_at = now() - interval '31 days'
			WHERE cart_id = (SELECT id FROM carts WHERE user_id IS NULL ORDER BY created_at LIMIT 1)`)
		w.run(t, worker.TypeCleanupGuestCarts)
		if n := ps.count(t, `SELECT count(*) FROM carts WHERE user_id IS NULL`); n != 1 {
			t.Errorf("%d guest carts, want the fresh one only", n)
		}
		assertError(t, ps.cartReq(t, http.MethodGet, "/v1/cart", nil, "", oldToken), http.StatusNotFound, "CART_NOT_FOUND")
		assertCart(t, ps.cartReq(t, http.MethodGet, "/v1/cart", nil, "", freshToken), "the fresh guest cart")
		if n := ps.count(t, `SELECT count(*) FROM carts WHERE user_id = $1`, b.ID); n != 1 {
			t.Errorf("the buyer's own cart is gone")
		}
	})

	t.Run("cleanup outbox", func(t *testing.T) {
		mustExec(t, ps.db, `UPDATE outbox_events SET published_at = now()`)
		old := queryStrings(t, ps.db, `SELECT id::text FROM outbox_events ORDER BY created_at LIMIT 2`)
		mustExec(t, ps.db, `UPDATE outbox_events SET published_at = now() - interval '8 days' WHERE id = ANY($1)`, old)
		unpublished := uuidx.NewV7()
		mustExec(t, ps.db, `INSERT INTO outbox_events (id, aggregate_type, aggregate_id, event_type, payload, created_at)
			VALUES ($1, 'order', gen_random_uuid(), 'order.created', '{}', now() - interval '30 days')`, unpublished)
		mustExec(t, ps.db, `INSERT INTO event_deliveries (event_id, consumer, delivered_at) VALUES
			($1, 'email:order-confirmation', now() - interval '8 days'), ($2, 'email:order-confirmation', now())`, old[0], uuidx.NewV7())
		total := ps.count(t, `SELECT count(*) FROM outbox_events`)
		w.run(t, worker.TypeCleanupOutbox)
		if n := ps.count(t, `SELECT count(*) FROM outbox_events`); n != total-2 {
			t.Errorf("%d events, want %d: the two published 8 days ago deleted", n, total-2)
		}
		if ps.count(t, `SELECT count(*) FROM outbox_events WHERE id = $1`, unpublished) != 1 {
			t.Error("an unpublished event was deleted, however old")
		}
		if n := ps.count(t, `SELECT count(*) FROM event_deliveries`); n != 1 {
			t.Errorf("%d delivery records, want the recent one", n)
		}
	})

	if dead := w.archived(t); len(dead) != 0 {
		t.Errorf("%d tasks in the dead-letter queue: %v", len(dead), dead[0].LastErr)
	}
}

// TestWorker_JobsWithServicesOff: with no gateway and no bucket, the
// payment and image jobs complete without doing anything, so a worker
// without Midtrans or S3 never fills its dead-letter queue.
func TestWorker_JobsWithServicesOff(t *testing.T) {
	sh := newShop(t, nil)
	w := startWorker(t, sh, workerOpts{})
	for _, job := range worker.Schedule {
		w.run(t, job.Type)
	}
	if dead := w.archived(t); len(dead) != 0 {
		t.Errorf("%d dead tasks", len(dead))
	}
}
