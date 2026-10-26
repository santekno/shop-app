package worker

import (
	"fmt"
	"os"

	"github.com/santekno/sdk/logx"
)

// asynqLogger writes Asynq's own log lines through logx, so the worker
// logs one format.
type asynqLogger struct{ l logx.Logger }

func (a asynqLogger) Debug(args ...any) { a.l.Debug(fmt.Sprint(args...)) }
func (a asynqLogger) Info(args ...any)  { a.l.Info(fmt.Sprint(args...)) }
func (a asynqLogger) Warn(args ...any)  { a.l.Warn(fmt.Sprint(args...)) }
func (a asynqLogger) Error(args ...any) { a.l.Error(fmt.Sprint(args...)) }

// Fatal is what Asynq calls when it cannot go on; it exits, as the
// interface requires.
func (a asynqLogger) Fatal(args ...any) {
	a.l.Error(fmt.Sprint(args...))
	os.Exit(1)
}
