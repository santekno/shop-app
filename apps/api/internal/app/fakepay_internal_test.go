package app

import (
	"context"
	"database/sql/driver"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

func TestRunFakePay_RefusesBeforeTouchingAnything(t *testing.T) {
	fakeOn := config.Config{Payment: config.Payment{Provider: config.PaymentFake}}
	tests := []struct {
		name    string
		cfg     config.Config
		args    []string
		wantErr string
	}{
		{
			name: "the real gateway", cfg: config.Config{Payment: config.Payment{Provider: config.PaymentMidtrans}},
			args: strings.Fields("GS-20261101-7KQ2M9"), wantErr: "fake-pay: needs APP_PAYMENT_PROVIDER=fake (never in production)",
		},
		{name: "no order", cfg: fakeOn, args: nil, wantErr: "fake-pay: usage: api fake-pay <order code> [status [fraud status]]"},
		{name: "too many arguments", cfg: fakeOn, args: strings.Fields("GS-20261101-7KQ2M9 capture accept extra"), wantErr: "fake-pay: usage: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			logger, logs := jsonLogger()
			err := runFakePay(context.Background(), tt.cfg, logger, tt.args)
			if err == nil {
				t.Fatalf("want error %q, got nil", tt.wantErr)
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wantErr), "err = %v", err)
			testx.AssertEqual(t, logs.Len(), 0, "nothing was opened")
		})
	}
}

// With valid arguments fake-pay opens the database first; without one it
// stops there, whatever the status.
func TestRunFakePay_NeedsTheDatabase(t *testing.T) {
	for _, args := range []string{"GS-20261101-7KQ2M9", "GS-20261101-7KQ2M9 expire", "GS-20261101-7KQ2M9 capture challenge"} {
		t.Run(args, func(t *testing.T) {
			logger, _ := jsonLogger()
			cfg := config.Config{
				Payment:  config.Payment{Provider: config.PaymentFake},
				Database: config.Database{URL: "postgres://user:pass@127.0.0.1:" + closedPort(t) + "/goshop?sslmode=disable"},
			}
			err := runFakePay(context.Background(), cfg, logger, strings.Fields(args))
			if err == nil {
				t.Fatal("want an error, got nil")
			}
			testx.AssertTrue(t, strings.HasPrefix(err.Error(), "open database: "), "err = %v", err)
			testx.AssertFalse(t, strings.Contains(err.Error(), "user:pass"), "the URL is not repeated: %v", err)
		})
	}
}

func TestFakePayOrderID(t *testing.T) {
	t.Run("a payment order_id is used as given", func(t *testing.T) {
		// The database would fail: it must not be asked.
		db := &recordingDB{err: errors.New("database down")}
		id, err := fakePayOrderID(context.Background(), db.open(t), "GS-20261101-7KQ2M9-K3D9QX")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, id, "GS-20261101-7KQ2M9-K3D9QX")
		testx.AssertEqual(t, len(db.queries()), 0)
	})
	t.Run("an order code finds its open payment", func(t *testing.T) {
		db := &recordingDB{row: []driver.Value{"GS-20261101-7KQ2M9-ABC123"}}
		id, err := fakePayOrderID(context.Background(), db.open(t), "GS-20261101-7KQ2M9")
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, id, "GS-20261101-7KQ2M9-ABC123")
		testx.AssertEqual(t, strings.Join(db.queries(), ","), "GetOpenPaymentByOrderCode")
		testx.AssertEqual(t, db.args[0][0], driver.Value("GS-20261101-7KQ2M9"))
	})
	// Anything not exactly <code>-<6 characters> is looked up as an order
	// code.
	for _, arg := range []string{
		"gs-20261101-7kq2m9-k3d9qx",       // lower case
		"GS-2026110-7KQ2M9-K3D9QX",        // 7 digits
		"GS-20261101-7KQ2M9-K3D9Q",        // 5 characters
		"GS-20261101-7KQ2M9-K3D9QXZ",      // 7 characters
		"xGS-20261101-7KQ2M9-K3D9QX",      // not anchored at the start
		"GS-20261101-7KQ2M9-K3D9QX\nDROP", // not anchored at the end
	} {
		t.Run("looked up: "+arg, func(t *testing.T) {
			db := &recordingDB{row: []driver.Value{"GS-20261101-7KQ2M9-ABC123"}}
			id, err := fakePayOrderID(context.Background(), db.open(t), arg)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, id, "GS-20261101-7KQ2M9-ABC123")
			testx.AssertEqual(t, strings.Join(db.queries(), ","), "GetOpenPaymentByOrderCode")
		})
	}
	t.Run("no open payment", func(t *testing.T) {
		db := &recordingDB{}
		_, err := fakePayOrderID(context.Background(), db.open(t), "GS-20261101-7KQ2M9")
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertEqual(t, err.Error(), "fake-pay: order GS-20261101-7KQ2M9 has no open payment; call POST /v1/orders/{id}/pay first")
	})
	t.Run("the database fails", func(t *testing.T) {
		errDown := errors.New("database down")
		_, err := fakePayOrderID(context.Background(), (&recordingDB{err: errDown}).open(t), "GS-20261101-7KQ2M9")
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertEqual(t, err.Error(), "fake-pay: find payment: database down")
		testx.AssertTrue(t, errors.Is(err, errDown))
	})
}
