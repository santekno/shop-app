package notify

// Bab 6 artikel 10: the retry limit of each task type.

import (
	"testing"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/testx"
)

func TestMaxRetry(t *testing.T) {
	tests := []struct {
		taskType string
		want     int
	}{
		{TypeSendEmail, 8},
		{TypeOrderConfirmationEmail, 8},
		{TypePaymentReceivedEmail, 8},
		{TypeOrderShippedEmail, 8},
		{TypeSellerPaidOrder, 5},
		{"outbox:publish", DefaultMaxRetry},
		{"anything:else", 3},
	}
	for _, tt := range tests {
		t.Run(tt.taskType, func(t *testing.T) {
			opt := MaxRetry(tt.taskType)
			testx.AssertEqual(t, opt.Type(), asynq.MaxRetryOpt)
			testx.AssertEqual(t, opt.Value(), any(tt.want))
		})
	}
}
