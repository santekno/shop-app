// Command worker is GoShop's background worker (ADR 0007): Asynq tasks
// from Redis, the scheduled jobs, and the outbox's emails and messages.
// The program lives in internal/worker; main only turns signals into a
// cancelled context and an error into an exit code.
//
//	worker              run until SIGTERM
//	worker healthcheck  exit 0 when the worker on this machine answers /healthz
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/santekno/shop-app/apps/api/internal/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	context.AfterFunc(ctx, stop)

	err := worker.Run(ctx, os.Args[1:], os.Stdout)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "worker:", err)
		os.Exit(1)
	}
}
