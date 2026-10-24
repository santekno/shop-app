package worker

import (
	"context"
	"math/rand/v2"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"
)

// The backoff between retries (ADR 0007): 10 s, 20 s, 40 s, … doubling up
// to an hour, each with up to 10% jitter, so tasks that failed together
// (a mail server down) do not all come back in the same second.
const (
	retryBase = 10 * time.Second
	retryMax  = time.Hour
)

// RetryDelay is the worker's asynq.RetryDelayFunc: retried is how many
// times the task was retried already.
func RetryDelay(retried int, _ error, _ *asynq.Task) time.Duration {
	d := retryMax
	if retried < 10 { // 10 s × 2^9 is past an hour already
		d = min(retryBase<<retried, retryMax)
	}
	return d + time.Duration(rand.Int64N(int64(d/10)+1)) // #nosec G404 -- jitter, not a secret
}

// logFailure is the worker's asynq.ErrorHandler: every failure at WARN
// with its attempt, and the last one, after which Asynq archives the
// task, at ERROR with the command that brings it back.
func logFailure(ctx context.Context, task *asynq.Task, err error) {
	retried, _ := asynq.GetRetryCount(ctx)
	maxRetry, _ := asynq.GetMaxRetry(ctx)
	id, _ := asynq.GetTaskID(ctx)
	log := logx.FromContext(ctx).With("task_id", id, "task", task.Type(), "retried", retried, "max_retry", maxRetry)
	if retried >= maxRetry {
		log.Error("task failed for good and is in the dead-letter queue; requeue it with: worker dead-tasks requeue "+id,
			"error", err.Error())
		return
	}
	log.Warn("task failed; it will be retried", "error", err.Error())
}
