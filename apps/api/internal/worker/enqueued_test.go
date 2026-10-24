package worker

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
)

// enqueued is the scheduler's after-enqueue hook: Asynq says nothing about
// a tick it could not enqueue unless told to. With two worker instances
// each scheduler enqueues every tick and the unique task lets one win, so
// a duplicate is normal (DEBUG); anything else means a job did not run
// (ERROR).
func TestEnqueued(t *testing.T) {
	tests := []struct {
		name      string
		err       error
		wantLevel string // "" : nothing logged
		wantMsg   string
	}{
		{name: "enqueued", err: nil},
		{name: "another worker enqueued this tick", err: asynq.ErrDuplicateTask, wantLevel: "DEBUG",
			wantMsg: "scheduled task already enqueued by another worker"},
		{name: "a wrapped duplicate", err: fmt.Errorf("enqueue: %w", asynq.ErrDuplicateTask), wantLevel: "DEBUG",
			wantMsg: "scheduled task already enqueued by another worker"},
		{name: "redis down", err: errors.New("dial tcp 10.0.0.7:6379: connection refused"), wantLevel: "ERROR",
			wantMsg: "could not enqueue a scheduled task"},
		{name: "a task ID conflict is not a duplicate", err: asynq.ErrTaskIDConflict, wantLevel: "ERROR",
			wantMsg: "could not enqueue a scheduled task"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var logs bytes.Buffer
			hook := enqueued(logx.New(logx.WithOutput(&logs), logx.WithFormat("json"), logx.WithLevel("debug")))
			hook(&asynq.TaskInfo{ID: "t-1", Type: TypePublishEvents}, tt.err)
			if tt.wantLevel == "" {
				testx.AssertEqual(t, logs.String(), "", "nothing to say about a tick that ran")
				return
			}
			lines := strings.Split(strings.TrimSpace(logs.String()), "\n")
			testx.AssertEqual(t, len(lines), 1)
			var line map[string]any
			testx.AssertNoError(t, json.Unmarshal([]byte(lines[0]), &line))
			testx.AssertEqual(t, line["level"], any(tt.wantLevel))
			testx.AssertEqual(t, line["msg"], any(tt.wantMsg))
			if tt.wantLevel == "ERROR" {
				testx.AssertEqual(t, line["error"], any(tt.err.Error()))
			}
		})
	}
}
