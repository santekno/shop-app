package worker

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
)

func TestRetryDelay_DoublesFromTenSecondsUpToAnHour(t *testing.T) {
	tests := []struct {
		retried int
		base    time.Duration
	}{
		{retried: 0, base: 10 * time.Second},
		{retried: 1, base: 20 * time.Second},
		{retried: 2, base: 40 * time.Second},
		{retried: 5, base: 320 * time.Second},
		{retried: 8, base: 2560 * time.Second},
		// 10 s × 2^9 = 5120 s, past the cap.
		{retried: 9, base: time.Hour},
		{retried: 10, base: time.Hour},
		{retried: 20, base: time.Hour},
		// A shift this far would overflow (negative or zero) without the
		// retried < 10 guard.
		{retried: 63, base: time.Hour},
		{retried: 64, base: time.Hour},
		{retried: 1000, base: time.Hour},
	}
	for _, tt := range tests {
		t.Run(fmt.Sprintf("retried %d", tt.retried), func(t *testing.T) {
			maxJitter := tt.base / 10
			lo, hi := time.Duration(1<<62), time.Duration(0)
			for range 200 {
				d := RetryDelay(tt.retried, errors.New("smtp down"), asynq.NewTask(TypePublishEvents, nil))
				lo, hi = min(lo, d), max(hi, d)
			}
			testx.AssertTrue(t, lo >= tt.base, "shortest delay %s is below the base %s", lo, tt.base)
			testx.AssertTrue(t, hi <= tt.base+maxJitter, "longest delay %s is past base + 10%% (%s)", hi, tt.base+maxJitter)
		})
	}
}

// Tasks that failed together must not all come back in the same second.
func TestRetryDelay_Jitters(t *testing.T) {
	for _, retried := range []int{0, 4, 12} {
		seen := map[time.Duration]bool{}
		for range 200 {
			seen[RetryDelay(retried, nil, nil)] = true
		}
		testx.AssertTrue(t, len(seen) > 10, "retried %d: only %d distinct delays in 200 tries", retried, len(seen))
	}
}

// failureLog is what logFailure writes for one failure.
type failureLog struct {
	Level    string `json:"level"`
	Msg      string `json:"msg"`
	Task     string `json:"task"`
	TaskID   string `json:"task_id"`
	Retried  int    `json:"retried"`
	MaxRetry int    `json:"max_retry"`
	Error    string `json:"error"`
}

func decodeFailureLog(t *testing.T, logs string) failureLog {
	t.Helper()
	for line := range strings.SplitSeq(strings.TrimSpace(logs), "\n") {
		var l failureLog
		if err := json.Unmarshal([]byte(line), &l); err != nil {
			t.Fatalf("decode log line %q: %v", line, err)
		}
		if strings.HasPrefix(l.Msg, "task failed") {
			return l
		}
	}
	t.Fatalf("no failure logged: %s", logs)
	return failureLog{}
}

// A context without Asynq's task metadata (retried 0, max retry 0) is a
// task that has no retry left.
func TestLogFailure_WithoutRetriesLogsErrorWithRequeueCommand(t *testing.T) {
	tests := []struct {
		name string
		err  error
	}{
		{name: "out of retries", err: errors.New("dial smtp: connection refused")},
		{name: "permanent error", err: fmt.Errorf("order gone: %w", asynq.SkipRetry)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			ctx := logx.WithContextLogger(context.Background(), logx.New(logx.WithOutput(&logs), logx.WithFormat("json")))

			logFailure(ctx, asynq.NewTask("email:send", []byte(secretPayload)), tt.err)

			l := decodeFailureLog(t, logs.String())
			testx.AssertEqual(t, l.Level, "ERROR")
			testx.AssertEqual(t, l.Msg, "task failed for good and is in the dead-letter queue; requeue it with: worker dead-tasks requeue ")
			testx.AssertEqual(t, l.Task, "email:send")
			testx.AssertEqual(t, l.Error, tt.err.Error())
			testx.AssertFalse(t, strings.Contains(logs.String(), "buyer@example.com"), "payload logged: %s", logs.String())
			testx.AssertFalse(t, strings.Contains(logs.String(), "vrf-7f3a9c2e"), "payload logged: %s", logs.String())
		})
	}
}

// The retry count logFailure reads lives in Asynq's internal context, set
// only by Asynq's processor: so a real asynq.Server (on the in-process
// fake Redis) runs one failing task, as the worker does.
func TestLogFailure_ThroughAsynq(t *testing.T) {
	tests := []struct {
		name      string
		retried   int64
		maxRetry  int64
		err       error
		wantLevel string
		wantMsg   string
		// wantScript is the Lua script Asynq runs next: retry or archive.
		wantScript string
	}{
		{
			name: "retries left: WARN, then retried", retried: 1, maxRetry: 3, err: errors.New("smtp: 451 try later"),
			wantLevel: "WARN", wantMsg: "task failed; it will be retried", wantScript: "retry",
		},
		{
			name: "last attempt: ERROR, then archived", retried: 3, maxRetry: 3, err: errors.New("smtp: 451 try later"),
			wantLevel: "ERROR", wantMsg: "task failed for good and is in the dead-letter queue; requeue it with: worker dead-tasks requeue task-7", wantScript: "archived",
		},
		{
			name: "permanent error with retries left: ERROR", retried: 0, maxRetry: 8, err: fmt.Errorf("order deleted: %w", asynq.SkipRetry),
			wantLevel: "ERROR", wantMsg: "task failed for good and is in the dead-letter queue; requeue it with: worker dead-tasks requeue task-7", wantScript: "archived",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeRedis{}
			f.enqueue(taskMessage{
				Type: "email:send", Payload: []byte(secretPayload), ID: "task-7", Queue: Queue,
				Retry: tt.maxRetry, Retried: tt.retried, Timeout: 60,
			}.encode())
			rdb := newFakeRedis(t, f)
			var logs syncBuffer
			logger := logx.New(logx.WithOutput(&logs), logx.WithFormat("json"))
			srv := asynq.NewServerFromRedisClient(rdb, asynq.Config{
				Concurrency:     1,
				Queues:          map[string]int{Queue: 1},
				BaseContext:     func() context.Context { return logx.WithContextLogger(context.Background(), logger) },
				Logger:          asynqLogger{logx.Noop()},
				ShutdownTimeout: time.Second,
				RetryDelayFunc:  RetryDelay,
				ErrorHandler:    asynq.ErrorHandlerFunc(logFailure),
			})
			mux := asynq.NewServeMux()
			mux.HandleFunc("email:send", func(context.Context, *asynq.Task) error { return tt.err })
			testx.AssertNoError(t, srv.Start(mux))
			waitFor(t, "the failure to be handled", func() bool {
				return len(f.scripts("asynq:{default}:t:task-7")) > 0
			})
			srv.Shutdown()

			l := decodeFailureLog(t, logs.String())
			testx.AssertEqual(t, l.Level, tt.wantLevel)
			testx.AssertEqual(t, l.Msg, tt.wantMsg)
			testx.AssertEqual(t, l.Task, "email:send")
			testx.AssertEqual(t, l.TaskID, "task-7")
			testx.AssertEqual(t, l.Retried, int(tt.retried))
			testx.AssertEqual(t, l.MaxRetry, int(tt.maxRetry))
			testx.AssertEqual(t, l.Error, tt.err.Error())
			testx.AssertFalse(t, strings.Contains(logs.String(), "buyer@example.com"), "payload logged: %s", logs.String())
			testx.AssertFalse(t, strings.Contains(logs.String(), "vrf-7f3a9c2e"), "payload logged: %s", logs.String())

			// Asynq retries or archives the task as logFailure said.
			f.mu.Lock()
			var script []any
			for _, args := range f.calls {
				if keys, _ := scriptKeysArgs(args); len(keys) > 3 && keys[0] == "asynq:{default}:t:task-7" {
					script = args
				}
			}
			f.mu.Unlock()
			keys, argv := scriptKeysArgs(script)
			testx.AssertEqual(t, keys[3], "asynq:{default}:"+tt.wantScript)
			if tt.wantScript == "retry" {
				// ARGV[3] is when the retry runs: RetryDelay(1) is 20-22 s.
				in := time.Until(time.Unix(argv[2].(int64), 0))
				testx.AssertTrue(t, in > 17*time.Second && in <= 23*time.Second, "retry in %s, want 20-22 s", in)
			}
		})
	}
}
