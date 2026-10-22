package health_test

import (
	"context"
	"errors"
	"sync"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/health"
)

func TestReadiness(t *testing.T) {
	tests := []struct {
		name         string
		drainTimes   int
		wantDraining bool
		wantErr      error
	}{
		{name: "zero value is ready", drainTimes: 0, wantDraining: false, wantErr: nil},
		{name: "draining after StartDraining", drainTimes: 1, wantDraining: true, wantErr: health.ErrShuttingDown},
		{name: "calling StartDraining again keeps draining", drainTimes: 3, wantDraining: true, wantErr: health.ErrShuttingDown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var r health.Readiness
			for range tt.drainTimes {
				r.StartDraining()
			}
			testx.AssertEqual(t, r.Draining(), tt.wantDraining)
			err := r.Check(context.Background())
			testx.AssertTrue(t, errors.Is(err, tt.wantErr), "Check() = %v, want %v", err, tt.wantErr)
		})
	}
}

func TestReadiness_ConcurrentUse(t *testing.T) {
	var r health.Readiness
	var wg sync.WaitGroup
	for range 8 {
		wg.Go(func() { _ = r.Check(context.Background()) })
	}
	wg.Go(r.StartDraining)
	wg.Wait()
	testx.AssertTrue(t, r.Draining())
	testx.AssertEqual(t, r.Check(context.Background()), health.ErrShuttingDown)
}
