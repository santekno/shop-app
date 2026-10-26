package payment

import (
	"fmt"
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

// Final: after which answer the reconciler stops asking about a payment
// GoShop closed. Only an answer after which Midtrans takes no money
// GoShop would not hear about is final.
func TestFinal(t *testing.T) {
	tests := []struct {
		tx, fraud string
		want      bool
	}{
		{"settlement", "", true},
		{"capture", "accept", true},
		{"capture", "", true},
		{"capture", "deny", true},
		{"capture", "challenge", false}, // a human at Midtrans still decides
		{"pending", "", false},          // the buyer may still pay
		{"expire", "", true},
		{"deny", "", true},
		{"cancel", "", true},
		{"failure", "", true},
		{"refund", "", true},
		{"partial_refund", "", true},
		{"chargeback", "", true},
		{"partial_chargeback", "", true},
		{"authorize", "", false}, // unknown: Midtrans may still move it
		{"", "", false},
		{"SETTLEMENT", "", false},
	}
	for _, tt := range tests {
		t.Run(tt.tx+"/"+tt.fraud, func(t *testing.T) {
			testx.AssertEqual(t, Final(statusOf(tt.tx, tt.fraud)), tt.want)
		})
	}
}

// Reconcile marks each successful check, final or not, by the answer; a
// failed check marks nothing (the payment keeps its place in its queue).
func TestService_Reconcile_MarksFinalByTheAnswer(t *testing.T) {
	tests := []struct {
		name      string
		status    TransactionStatus
		statusErr error
		applyErr  error
		wantMark  bool
		wantFinal bool
	}{
		{name: "settlement", status: settlement(), wantMark: true, wantFinal: true},
		{name: "pending", status: statusOf("pending", ""), wantMark: true, wantFinal: false},
		{name: "challenge", status: statusOf("capture", "challenge"), wantMark: true, wantFinal: false},
		{name: "unknown status", status: statusOf("authorize", ""), wantMark: true, wantFinal: false},
		{name: "deny", status: statusOf("deny", ""), wantMark: true, wantFinal: true},
		{name: "expire", status: statusOf("expire", ""), wantMark: true, wantFinal: true},
		{name: "404 before expiry", statusErr: ErrTransactionNotFound, wantMark: true, wantFinal: false},
		{name: "gateway down", statusErr: fmt.Errorf("%w: timeout", ErrGatewayUnavailable), wantMark: false},
		{name: "apply fails", status: settlement(), applyErr: errBoom, wantMark: false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			p := testPayment()
			p.Status = StatusCancelled
			p.ExpiresAt = testNow.Add(time.Hour) // a 404 is "not started yet"
			repo := &fakeRepo{toReconcile: []Payment{p}, outcome: OutcomeRecorded, applyErr: tt.applyErr}
			gw := newFakeGateway()
			gw.status, gw.statusErr = tt.status, tt.statusErr
			_, err := newTestService(repo, &fakeOrders{}, gw).Reconcile(t.Context())
			testx.AssertNoError(t, err)
			if !tt.wantMark {
				testx.AssertEqual(t, len(repo.checked), 0, "a failed check marks nothing")
				return
			}
			testx.AssertEqual(t, len(repo.checkedFinal), 1)
			testx.AssertEqual(t, repo.checkedFinal[0], tt.wantFinal)
			testx.AssertEqual(t, repo.checkedAt[0], testNow)
		})
	}
}
