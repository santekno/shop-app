package banner

import (
	"context"
	"errors"
	"testing"

	"github.com/santekno/sdk/testx"
)

// fakeRepo is a Repository that answers from its fields.
type fakeRepo struct {
	banners []Banner
	err     error
	calls   int
}

func (f *fakeRepo) ListActive(context.Context) ([]Banner, error) {
	f.calls++
	return f.banners, f.err
}

func TestService_List(t *testing.T) {
	boom := errors.New("connection refused")
	tests := []struct {
		name    string
		repo    *fakeRepo
		wantIDs []string
		wantErr error
	}{
		{
			name:    "keeps the order the repository gives",
			repo:    &fakeRepo{banners: []Banner{{ID: "b2", Title: "Dua"}, {ID: "b1", Title: "Satu"}, {ID: "b3", Title: "Tiga"}}},
			wantIDs: []string{"b2", "b1", "b3"},
		},
		{name: "no banners is an empty list, not an error", repo: &fakeRepo{}, wantIDs: nil},
		{name: "a repository error is wrapped and returned", repo: &fakeRepo{err: boom}, wantErr: boom},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NewService(tt.repo).List(context.Background())

			testx.AssertEqual(t, tt.repo.calls, 1)
			if tt.wantErr != nil {
				testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v", err)
				testx.AssertEqual(t, err.Error(), "list banners: connection refused")
				testx.AssertEqual(t, len(got), 0, "no banners with an error")
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(got), len(tt.wantIDs))
			for i, id := range tt.wantIDs {
				testx.AssertEqual(t, got[i].ID, id, "banner %d", i)
			}
		})
	}
}
