package worker

import (
	"bytes"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"
)

const (
	archivedKey = "asynq:{default}:archived"
	allQueues   = "asynq:queues"
)

// deadTask is an archived task message as Asynq stores it.
func deadTask(id, taskType string, retried int64, failedAt time.Time, lastErr string) []byte {
	return taskMessage{
		Type: taskType, ID: id, Queue: Queue, Retry: 8, Retried: retried, Timeout: 60,
		ErrorMsg: lastErr, LastFailedAt: failedAt.Unix(),
		// The payload holds the buyer's address: it must never be printed.
		Payload: []byte(`{"to":"buyer@example.com"}`),
	}.encode()
}

// archive answers Asynq's list script with pages, 100 tasks each, by the
// page's start offset.
func archive(tasks [][]byte) func(redis.Cmder) bool {
	return func(cmd redis.Cmder) bool {
		if !isScript(cmd, archivedKey, 1) {
			return false
		}
		_, argv := scriptKeysArgs(cmd.Args())
		start, _ := argv[0].(int64)
		var data []any
		for i := int(start); i < len(tasks) && i < int(start)+100; i++ {
			data = append(data, string(tasks[i]), int64(1700000000), nil)
		}
		cmd.(*redis.Cmd).SetVal(data)
		return true
	}
}

func TestDeadTasks_List(t *testing.T) {
	failed := time.Date(2026, 11, 1, 9, 30, 0, 0, time.FixedZone("WIB", 7*3600))
	longErr := strings.Repeat("x", 130)
	f := &fakeRedis{answer: archive([][]byte{
		deadTask("task-1", "email:send", 8, failed, "dial tcp smtp.example.com:587:\n  connection   refused"),
		deadTask("task-2", "telegram:paid-order", 5, failed, longErr),
	})}
	var out bytes.Buffer

	err := deadTasks(newFakeRedis(t, f), []string{"list"}, &out)

	testx.AssertNoError(t, err)
	lines := strings.Split(strings.TrimRight(out.String(), "\n"), "\n")
	testx.AssertEqual(t, len(lines), 4, "header, two tasks, footer: %q", out.String())
	testx.AssertEqual(t, strings.Join(strings.Fields(lines[0]), " "), "ID TYPE RETRIED FAILED AT LAST ERROR")
	testx.AssertEqual(t, strings.Join(strings.Fields(lines[1]), " "),
		"task-1 email:send 8 2026-11-01T02:30:00Z dial tcp smtp.example.com:587: connection refused")
	testx.AssertEqual(t, strings.Join(strings.Fields(lines[2]), " "),
		"task-2 telegram:paid-order 5 2026-11-01T02:30:00Z "+strings.Repeat("x", 120)+"…")
	testx.AssertEqual(t, strings.TrimSpace(lines[3]), "2 dead tasks")
	testx.AssertFalse(t, strings.Contains(out.String(), "buyer@example.com"), "a payload was printed: %s", out.String())
	testx.AssertEqual(t, len(f.scripts(archivedKey)), 1, "a short page is the last one")
	// The list checks the queue exists first.
	testx.AssertEqual(t, fmt.Sprint(f.calls[0]), fmt.Sprint([]any{"sismember", allQueues, Queue}))
}

func TestDeadTasks_ListPagesThroughAFullArchive(t *testing.T) {
	tasks := make([][]byte, 0, 150)
	for i := range 150 {
		tasks = append(tasks, deadTask(fmt.Sprintf("task-%03d", i), "email:send", 8, time.Unix(1700000000, 0), "boom"))
	}
	f := &fakeRedis{answer: archive(tasks)}
	var out bytes.Buffer

	testx.AssertNoError(t, deadTasks(newFakeRedis(t, f), []string{"list"}, &out))

	pages := f.scripts(archivedKey)
	testx.AssertEqual(t, len(pages), 2, "a full page of 100 asks for the next")
	testx.AssertEqual(t, fmt.Sprint(pages[0][:2]), "[0 99]")
	testx.AssertEqual(t, fmt.Sprint(pages[1][:2]), "[100 199]")
	testx.AssertContains(t, out.String(), "task-000 ")
	testx.AssertContains(t, out.String(), "task-149 ")
	testx.AssertTrue(t, strings.HasSuffix(out.String(), "150 dead tasks\n"), "footer: %q", out.String())

	// Exactly 100 tasks: the empty second page ends the listing.
	f = &fakeRedis{answer: archive(tasks[:100])}
	out.Reset()
	testx.AssertNoError(t, deadTasks(newFakeRedis(t, f), []string{"list"}, &out))
	testx.AssertEqual(t, len(f.scripts(archivedKey)), 2)
	testx.AssertTrue(t, strings.HasSuffix(out.String(), "100 dead tasks\n"), "footer: %q", out.String())
}

func TestDeadTasks_ListEmptyAndFailing(t *testing.T) {
	t.Run("nothing archived", func(t *testing.T) {
		f := &fakeRedis{answer: archive(nil)}
		var out bytes.Buffer
		testx.AssertNoError(t, deadTasks(newFakeRedis(t, f), []string{"list"}, &out))
		testx.AssertEqual(t, strings.Join(strings.Fields(out.String()), " "), "ID TYPE RETRIED FAILED AT LAST ERROR 0 dead tasks")
	})
	t.Run("output fails", func(t *testing.T) {
		f := &fakeRedis{answer: archive(nil)}
		err := deadTasks(newFakeRedis(t, f), []string{"list"}, failingWriter{})
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertEqual(t, err.Error(), "print dead tasks: stdout closed")
	})
	t.Run("redis fails", func(t *testing.T) {
		f := &fakeRedis{answer: func(cmd redis.Cmder) bool {
			cmd.SetErr(errors.New("READONLY replica"))
			return true
		}}
		var out bytes.Buffer
		err := deadTasks(newFakeRedis(t, f), []string{"list"}, &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "list dead tasks: "), "err = %v", err)
		testx.AssertContains(t, err.Error(), "READONLY replica")
	})
}

// failingWriter is an output that cannot be written to.
type failingWriter struct{}

func (failingWriter) Write([]byte) (int, error) { return 0, errors.New("stdout closed") }

func TestDeadTasks_Requeue(t *testing.T) {
	taskKey := "asynq:{default}:t:task-1"
	tests := []struct {
		name    string
		answer  func(redis.Cmder) bool
		wantOut string
		wantErr string
	}{
		{name: "requeued", wantOut: "requeued task-1\n"},
		{
			name: "no such task",
			answer: func(cmd redis.Cmder) bool {
				if !isScript(cmd, taskKey, 3) {
					return false
				}
				cmd.(*redis.Cmd).SetVal(int64(0))
				return true
			},
			wantErr: "requeue task task-1: asynq: task not found",
		},
		{
			name: "redis fails",
			answer: func(cmd redis.Cmder) bool {
				cmd.SetErr(errors.New("connection reset"))
				return true
			},
			wantErr: "requeue task task-1: ",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			f := &fakeRedis{answer: tt.answer}
			var out bytes.Buffer

			err := deadTasks(newFakeRedis(t, f), []string{"requeue", "task-1"}, &out)

			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("want error %q, got nil", tt.wantErr)
				}
				testx.AssertTrue(t, strings.HasPrefix(err.Error(), tt.wantErr), "err = %v", err)
				testx.AssertEqual(t, out.Len(), 0)
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, out.String(), tt.wantOut)
			testx.AssertEqual(t, len(f.scripts(taskKey)), 1, "the run-task script ran for task-1")
		})
	}
}

func TestDeadTasks_RequeueAll(t *testing.T) {
	t.Run("requeued", func(t *testing.T) {
		f := &fakeRedis{answer: func(cmd redis.Cmder) bool {
			if !isScript(cmd, archivedKey, 2) {
				return false
			}
			cmd.(*redis.Cmd).SetVal(int64(4))
			return true
		}}
		var out bytes.Buffer
		testx.AssertNoError(t, deadTasks(newFakeRedis(t, f), []string{"requeue-all"}, &out))
		testx.AssertEqual(t, out.String(), "requeued 4 tasks\n")
	})
	t.Run("queue unknown", func(t *testing.T) {
		f := &fakeRedis{answer: func(cmd redis.Cmder) bool {
			if c, ok := cmd.(*redis.BoolCmd); ok {
				c.SetVal(false)
				return true
			}
			return false
		}}
		var out bytes.Buffer
		err := deadTasks(newFakeRedis(t, f), []string{"requeue-all"}, &out)
		if err == nil {
			t.Fatal("want an error, got nil")
		}
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "requeue dead tasks: "), "err = %v", err)
		testx.AssertEqual(t, out.Len(), 0)
	})
}

func TestDeadTasks_UnknownArguments(t *testing.T) {
	for _, args := range [][]string{nil, {}, {"requeue"}, {"list", "x"}, {"nope"}, {"requeue-all", "now"}, {"requeue", "a", "b"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			f := &fakeRedis{}
			var out bytes.Buffer
			err := deadTasks(newFakeRedis(t, f), args, &out)
			if err == nil {
				t.Fatalf("args %q: want a usage error, got nil", args)
			}
			testx.AssertEqual(t, err.Error(), fmt.Sprintf("unknown arguments %q (usage: worker dead-tasks list|requeue <task id>|requeue-all)", args))
			testx.AssertEqual(t, out.Len(), 0)
			testx.AssertEqual(t, len(f.calls), 0, "nothing is sent to Redis")
		})
	}
}

func TestOneLine(t *testing.T) {
	tests := []struct {
		in    string
		limit int
		want  string
	}{
		{in: "", limit: 10, want: ""},
		{in: "short", limit: 10, want: "short"},
		{in: "  a\n\tb   c  ", limit: 10, want: "a b c"},
		{in: "0123456789", limit: 10, want: "0123456789"},
		{in: "0123456789A", limit: 10, want: "0123456789…"},
		{in: "line one\nline two that is long", limit: 12, want: "line one lin…"},
	}
	for _, tt := range tests {
		testx.AssertEqual(t, oneLine(tt.in, tt.limit), tt.want, "oneLine(%q, %d)", tt.in, tt.limit)
	}
}
