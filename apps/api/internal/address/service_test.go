package address_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/address"
)

// fakeRepo is an address.Repository that records the ids it was given.
type fakeRepo struct {
	err     error
	userID  string
	id      string
	created address.Input
}

func (r *fakeRepo) List(_ context.Context, userID string) ([]address.Address, error) {
	r.userID = userID
	return []address.Address{{ID: addrID}}, r.err
}

func (r *fakeRepo) Get(_ context.Context, userID, id string) (address.Address, error) {
	r.userID, r.id = userID, id
	return address.Address{ID: id}, r.err
}

func (r *fakeRepo) Create(_ context.Context, userID, id string, in address.Input) (address.Address, error) {
	r.userID, r.id, r.created = userID, id, in
	return address.Address{ID: id}, r.err
}

func (r *fakeRepo) Update(_ context.Context, userID, id string, _ address.Patch) (address.Address, error) {
	r.userID, r.id = userID, id
	return address.Address{ID: id}, r.err
}

func (r *fakeRepo) Delete(_ context.Context, userID, id string) error {
	r.userID, r.id = userID, id
	return r.err
}

func TestService_PassesTheOwner(t *testing.T) {
	repo := &fakeRepo{}
	svc := address.NewService(repo)
	ctx := context.Background()

	list, err := svc.List(ctx, me)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(list), 1)
	testx.AssertEqual(t, repo.userID, me)

	_, err = svc.Get(ctx, me, addrID)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, repo.userID+"/"+repo.id, me+"/"+addrID)

	a, err := svc.Create(ctx, me, address.Input{Label: "Rumah"})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, repo.userID, me)
	testx.AssertEqual(t, repo.created.Label, "Rumah")
	testx.AssertEqual(t, a.ID, repo.id)
	testx.AssertEqual(t, len(repo.id), 36)
	testx.AssertEqual(t, repo.id[14:15], "7", "new ids are UUIDv7: %q", repo.id)

	_, err = svc.Update(ctx, me, addrID, address.Patch{})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, repo.userID+"/"+repo.id, me+"/"+addrID)

	testx.AssertNoError(t, svc.Delete(ctx, me, addrID))
	testx.AssertEqual(t, repo.userID+"/"+repo.id, me+"/"+addrID)
}

func TestService_WrapsErrors(t *testing.T) {
	svc := address.NewService(&fakeRepo{err: address.ErrNotFound})
	ctx := context.Background()
	checks := map[string]error{}
	_, checks["list addresses: "] = svc.List(ctx, me)
	_, checks["get address "+addrID+": "] = svc.Get(ctx, me, addrID)
	_, checks["create address: "] = svc.Create(ctx, me, address.Input{})
	_, checks["update address "+addrID+": "] = svc.Update(ctx, me, addrID, address.Patch{})
	checks["delete address "+addrID+": "] = svc.Delete(ctx, me, addrID)
	for prefix, err := range checks {
		testx.AssertTrue(t, errors.Is(err, address.ErrNotFound), "%s err = %v", prefix, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), prefix), "err = %v", err)
	}
}
