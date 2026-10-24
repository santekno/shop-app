package worker

import (
	"fmt"
	"io"
	"strings"
	"text/tabwriter"
	"time"

	"github.com/hibiken/asynq"
	"github.com/redis/go-redis/v9"
)

// The dead-letter queue (ADR 0007) is Asynq's "archived" state: a task
// that ran out of retries waits there for an operator, who lists it, fixes
// the cause (a wrong SMTP password, a chat the bot was removed from) and
// requeues it. Asynq drops archived tasks after 90 days, or beyond 10 000.

// deadTasks is `worker dead-tasks list | requeue <task id> | requeue-all`.
// Payloads are never printed: they may hold an email address.
func deadTasks(rdb redis.UniversalClient, args []string, out io.Writer) error {
	inspector := asynq.NewInspectorFromRedisClient(rdb)
	switch {
	case len(args) == 1 && args[0] == "list":
		return listDeadTasks(inspector, out)
	case len(args) == 2 && args[0] == "requeue":
		if err := inspector.RunTask(Queue, args[1]); err != nil {
			return fmt.Errorf("requeue task %s: %w", args[1], err)
		}
		_, _ = fmt.Fprintf(out, "requeued %s\n", args[1])
		return nil
	case len(args) == 1 && args[0] == "requeue-all":
		n, err := inspector.RunAllArchivedTasks(Queue)
		if err != nil {
			return fmt.Errorf("requeue dead tasks: %w", err)
		}
		_, _ = fmt.Fprintf(out, "requeued %d tasks\n", n)
		return nil
	default:
		return fmt.Errorf("unknown arguments %q (usage: worker dead-tasks list|requeue <task id>|requeue-all)", args)
	}
}

// listDeadTasks prints every archived task, newest page first, one line
// each.
func listDeadTasks(inspector *asynq.Inspector, out io.Writer) error {
	w := tabwriter.NewWriter(out, 0, 0, 2, ' ', 0)
	_, _ = fmt.Fprintln(w, "ID\tTYPE\tRETRIED\tFAILED AT\tLAST ERROR")
	total := 0
	for page := 1; ; page++ {
		tasks, err := inspector.ListArchivedTasks(Queue, asynq.Page(page), asynq.PageSize(100))
		if err != nil {
			return fmt.Errorf("list dead tasks: %w", err)
		}
		for _, t := range tasks {
			_, _ = fmt.Fprintf(w, "%s\t%s\t%d\t%s\t%s\n", t.ID, t.Type, t.Retried,
				t.LastFailedAt.UTC().Format(time.RFC3339), oneLine(t.LastErr, 120))
		}
		total += len(tasks)
		if len(tasks) < 100 {
			break
		}
	}
	_, _ = fmt.Fprintf(w, "%d dead tasks\n", total)
	if err := w.Flush(); err != nil {
		return fmt.Errorf("print dead tasks: %w", err)
	}
	return nil
}

func oneLine(s string, limit int) string {
	s = strings.Join(strings.Fields(s), " ")
	if len(s) > limit {
		return s[:limit] + "…"
	}
	return s
}
