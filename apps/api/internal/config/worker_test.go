package config_test

import (
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
)

func TestLoad_WorkerConcurrency(t *testing.T) {
	testx.AssertEqual(t, config.DefaultWorkerConcurrency, 5)
	tests := []struct {
		value string
		want  int
		ok    bool
	}{
		{value: "", want: 5, ok: true},
		{value: "1", want: 1, ok: true},
		{value: "50", want: 50, ok: true},
		{value: "0"},
		{value: "51"},
		{value: "-3"},
		{value: "five"},
	}
	for _, tt := range tests {
		t.Run(tt.value, func(t *testing.T) {
			cfg, err := loadBab6(t, "production", map[string]string{"APP_WORKER_CONCURRENCY": tt.value})
			if tt.ok {
				testx.AssertNoError(t, err)
				testx.AssertEqual(t, cfg.WorkerConcurrency, tt.want)
				return
			}
			testx.AssertError(t, err)
			testx.AssertContains(t, err.Error(), `APP_WORKER_CONCURRENCY: must be a number between 1 and 50, got "`+tt.value+`"`)
		})
	}
}
