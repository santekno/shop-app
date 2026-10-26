package app

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"

	"github.com/santekno/sdk/logx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/database"
	"github.com/santekno/shop-app/apps/api/internal/db/sqlc"
	"github.com/santekno/shop-app/apps/api/internal/payment/fake"
	"github.com/santekno/shop-app/apps/api/internal/redisconn"
)

// providerOrderID is a payment's Midtrans order_id: the order code and 6
// characters.
var providerOrderID = regexp.MustCompile(`^GS-[0-9]{8}-[0-9A-Z]{6}-[0-9A-Z]{6}$`)

// runFakePay is `api fake-pay <order code | payment order_id> [status
// [fraud status]]` (ADR 0007): what Midtrans does when a buyer pays, for
// local development with APP_PAYMENT_PROVIDER=fake. It sets the fake
// transaction's status (settlement by default; capture, pending, deny,
// cancel, expire, failure, refund, partial_refund) and sends the signed
// notification to the API on this machine's port, which then handles it
// like any other: signature, status call, guarded transitions. Run it next
// to the API (make fake-pay order=GS-…, inside the api container).
func runFakePay(ctx context.Context, cfg config.Config, logger logx.Logger, args []string) error {
	if cfg.Payment.Provider != config.PaymentFake {
		return errors.New("fake-pay: needs APP_PAYMENT_PROVIDER=fake (never in production)")
	}
	if len(args) < 1 || len(args) > 3 {
		return errors.New("fake-pay: usage: api fake-pay <order code> [status [fraud status]]")
	}
	status, fraudStatus := "settlement", ""
	if len(args) > 1 {
		status = args[1]
	}
	if len(args) > 2 {
		fraudStatus = args[2]
	}
	db, err := database.Open(ctx, cfg.Database, logger)
	if err != nil {
		return err
	}
	defer closeDB(db, logger)
	orderID, err := fakePayOrderID(ctx, db, args[0])
	if err != nil {
		return err
	}
	rdb, err := redisconn.Open(ctx, cfg.RedisURL)
	if err != nil {
		return err
	}
	defer closeRedis(rdb, logger)

	n, err := fake.New(fake.NewRedisStore(rdb)).Pay(ctx, orderID, status, fraudStatus)
	if err != nil {
		return fmt.Errorf("fake-pay: %w", err)
	}
	url := "http://127.0.0.1:" + strconv.Itoa(cfg.Port) + "/v1/payments/midtrans/notification"
	code, body, err := fake.Send(ctx, url, n)
	if err != nil {
		return fmt.Errorf("fake-pay: %w", err)
	}
	logger.Info("fake payment notification sent", "order_id", orderID, "status", status, "answer", code, "body", body)
	if code != 200 {
		return fmt.Errorf("fake-pay: the API answered %d: %s", code, body)
	}
	return nil
}

// fakePayOrderID is the payment order_id to pay: arg itself, or the open
// payment of the order whose code is arg.
func fakePayOrderID(ctx context.Context, db *sql.DB, arg string) (string, error) {
	if providerOrderID.MatchString(arg) {
		return arg, nil
	}
	id, err := sqlc.New(db).GetOpenPaymentByOrderCode(ctx, arg)
	if errors.Is(err, sql.ErrNoRows) {
		return "", fmt.Errorf("fake-pay: order %s has no open payment; call POST /v1/orders/{id}/pay first", arg)
	}
	if err != nil {
		return "", fmt.Errorf("fake-pay: find payment: %w", err)
	}
	return id, nil
}
