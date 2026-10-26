package notify

import "github.com/hibiken/asynq"

// Retry limits per task type (ADR 0007): how many times Asynq retries a
// failing task, with RetryDelay's backoff, before it moves it to the
// archived (dead-letter) queue for an operator. An email may wait for a
// mail server that is down for hours; a chat message is worth less once
// it is late.
var maxRetries = map[string]int{
	TypeSendEmail:              8,
	TypeOrderConfirmationEmail: 8,
	TypePaymentReceivedEmail:   8,
	TypeOrderShippedEmail:      8,
	TypeSellerPaidOrder:        5,
}

// DefaultMaxRetry is the limit of every other task type: the scheduled
// jobs, which also run again at their next tick.
const DefaultMaxRetry = 3

// MaxRetry is the asynq.MaxRetry option of taskType.
func MaxRetry(taskType string) asynq.Option {
	if n, ok := maxRetries[taskType]; ok {
		return asynq.MaxRetry(n)
	}
	return asynq.MaxRetry(DefaultMaxRetry)
}
