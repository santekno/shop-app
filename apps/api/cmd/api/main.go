// Command api is the GoShop REST API. The program lives in internal/app;
// main only turns signals into a cancelled context and an error into an exit
// code.
//
//	api              serve the API
//	api healthcheck  exit 0 when the API on this machine answers /healthz
//	api migrate      apply the database migrations and exit
//	api expire-orders  cancel unpaid orders past their deadline once and exit
//	api cleanup-idempotency-keys  delete expired checkout idempotency keys and exit
package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"

	"github.com/santekno/shop-app/apps/api/internal/app"
)

func main() {
	// SIGINT is Ctrl+C; SIGTERM is what Docker and Railway send to stop a
	// container. Either one cancels ctx, which starts the graceful shutdown.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	// After the first signal, stop listening for more: a second Ctrl+C then
	// kills the process at once instead of waiting for the drain.
	context.AfterFunc(ctx, stop)

	err := app.Run(ctx, os.Args[1:], os.Stdout)
	stop()
	if err != nil {
		fmt.Fprintln(os.Stderr, "api:", err)
		os.Exit(1)
	}
}
