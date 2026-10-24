package worker

import (
	"bytes"
	"encoding/json"
	"strings"
	"testing"

	"github.com/santekno/sdk/logx"
	"github.com/santekno/sdk/testx"
)

// Asynq's own lines go through logx, one JSON line each, at their level.
// Fatal exits the process, so it is not called here.
func TestAsynqLogger(t *testing.T) {
	tests := []struct {
		name  string
		log   func(asynqLogger, ...any)
		level string
	}{
		{name: "debug", log: asynqLogger.Debug, level: "DEBUG"},
		{name: "info", log: asynqLogger.Info, level: "INFO"},
		{name: "warn", log: asynqLogger.Warn, level: "WARN"},
		{name: "error", log: asynqLogger.Error, level: "ERROR"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var out bytes.Buffer
			l := asynqLogger{logx.New(logx.WithOutput(&out), logx.WithFormat("json"), logx.WithLevel("debug"))}

			tt.log(l, "Starting processing: ", 3, " workers")

			lines := strings.Split(strings.TrimSpace(out.String()), "\n")
			testx.AssertEqual(t, len(lines), 1)
			var line struct {
				Level string `json:"level"`
				Msg   string `json:"msg"`
			}
			testx.AssertNoError(t, json.Unmarshal([]byte(lines[0]), &line))
			testx.AssertEqual(t, line.Level, tt.level)
			testx.AssertEqual(t, line.Msg, "Starting processing: 3 workers")
		})
	}
}
