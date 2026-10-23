package cart

import (
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// fakeRepo is a Repository that records each call and answers from its
// fields.
type fakeRepo struct {
	calls  []string
	owners []Owner
	cart   Cart
	getErr error
	err    error  // for the writes
	token  string // what Add returns
	merged [2]string
}

func (f *fakeRepo) Get(_ context.Context, owner Owner) (Cart, error) {
	f.calls = append(f.calls, "Get")
	f.owners = append(f.owners, owner)
	return f.cart, f.getErr
}

func (f *fakeRepo) Add(_ context.Context, owner Owner, variantID string, _ int32) (string, error) {
	f.calls = append(f.calls, "Add "+variantID)
	f.owners = append(f.owners, owner)
	return f.token, f.err
}

func (f *fakeRepo) SetQuantity(_ context.Context, owner Owner, variantID string, _ int32) error {
	f.calls = append(f.calls, "SetQuantity "+variantID)
	f.owners = append(f.owners, owner)
	return f.err
}

func (f *fakeRepo) Remove(_ context.Context, owner Owner, variantID string) error {
	f.calls = append(f.calls, "Remove "+variantID)
	f.owners = append(f.owners, owner)
	return f.err
}

func (f *fakeRepo) Merge(_ context.Context, userID, token string) error {
	f.calls = append(f.calls, "Merge")
	f.merged = [2]string{userID, token}
	return f.err
}

func oneLineCart() Cart { return Cart{Lines: []Line{okLine(v1, 2, 50000, 10)}} }

func TestService_Get(t *testing.T) {
	repo := &fakeRepo{cart: oneLineCart()}
	c, err := NewService(repo).Get(context.Background(), Owner{UserID: userID})
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(c.Lines), 1)

	repo.getErr = errBoom
	_, err = NewService(repo).Get(context.Background(), Owner{UserID: userID})
	testx.AssertTrue(t, errors.Is(err, errBoom))
	testx.AssertEqual(t, err.Error(), "get cart: boom")
}

func TestService_Add(t *testing.T) {
	t.Run("a user's cart: no token, then the whole cart", func(t *testing.T) {
		repo := &fakeRepo{cart: oneLineCart()}
		c, token, err := NewService(repo).Add(context.Background(), Owner{UserID: userID}, v1, 2)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, token, "")
		testx.AssertEqual(t, len(c.Lines), 1)
		testx.AssertEqual(t, strings.Join(repo.calls, ","), "Add "+v1+",Get")
	})
	t.Run("a new guest cart is read back with its new token", func(t *testing.T) {
		repo := &fakeRepo{cart: oneLineCart(), token: "new-token"}
		_, token, err := NewService(repo).Add(context.Background(), Owner{}, v1, 1)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, token, "new-token")
		testx.AssertEqual(t, repo.owners[1], Owner{Token: "new-token"}, "Get reads the cart just created")
	})
	for _, q := range []int32{0, -1, MaxQuantity + 1} {
		t.Run("quantity out of range is refused before the repository", func(t *testing.T) {
			repo := &fakeRepo{}
			_, _, err := NewService(repo).Add(context.Background(), Owner{UserID: userID}, v1, q)
			testx.AssertTrue(t, errors.Is(err, ErrQuantityLimit), "quantity %d: %v", q, err)
			testx.AssertEqual(t, len(repo.calls), 0)
		})
	}
	t.Run("the bounds themselves are fine", func(t *testing.T) {
		for _, q := range []int32{1, MaxQuantity} {
			_, _, err := NewService(&fakeRepo{}).Add(context.Background(), Owner{UserID: userID}, v1, q)
			testx.AssertNoError(t, err)
		}
	})
	t.Run("a repository error is wrapped and nothing is read", func(t *testing.T) {
		repo := &fakeRepo{err: &InsufficientStockError{Available: 1}}
		_, token, err := NewService(repo).Add(context.Background(), Owner{UserID: userID}, v1, 5)
		var stock *InsufficientStockError
		testx.AssertTrue(t, errors.As(err, &stock))
		testx.AssertEqual(t, err.Error(), "add to cart: insufficient stock")
		testx.AssertEqual(t, token, "")
		testx.AssertEqual(t, len(repo.calls), 1)
	})
}

func TestService_SetQuantity(t *testing.T) {
	repo := &fakeRepo{cart: oneLineCart()}
	c, err := NewService(repo).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 3)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(c.Lines), 1)
	testx.AssertEqual(t, strings.Join(repo.calls, ","), "SetQuantity "+v1+",Get")

	for _, q := range []int32{0, MaxQuantity + 1} {
		repo := &fakeRepo{}
		_, err := NewService(repo).SetQuantity(context.Background(), Owner{UserID: userID}, v1, q)
		testx.AssertTrue(t, errors.Is(err, ErrQuantityLimit), "quantity %d", q)
		testx.AssertEqual(t, len(repo.calls), 0)
	}

	repo = &fakeRepo{err: ErrLineNotFound}
	_, err = NewService(repo).SetQuantity(context.Background(), Owner{UserID: userID}, v1, 1)
	testx.AssertTrue(t, errors.Is(err, ErrLineNotFound))
	testx.AssertEqual(t, err.Error(), "update cart line: cart line not found")
}

func TestService_Remove(t *testing.T) {
	repo := &fakeRepo{}
	c, err := NewService(repo).Remove(context.Background(), Owner{UserID: userID}, v1)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(c.Lines), 0)
	testx.AssertEqual(t, strings.Join(repo.calls, ","), "Remove "+v1+",Get")

	repo = &fakeRepo{err: ErrLineNotFound}
	_, err = NewService(repo).Remove(context.Background(), Owner{UserID: userID}, v1)
	testx.AssertEqual(t, err.Error(), "remove cart line: cart line not found")
	testx.AssertEqual(t, len(repo.calls), 1)
}

func TestService_Merge(t *testing.T) {
	repo := &fakeRepo{cart: oneLineCart()}
	c, err := NewService(repo).Merge(context.Background(), userID, "guest-token")
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(c.Lines), 1)
	testx.AssertEqual(t, repo.merged, [2]string{userID, "guest-token"})
	testx.AssertEqual(t, repo.owners[0], Owner{UserID: userID}, "the user's cart is returned, not the guest's")

	repo = &fakeRepo{err: ErrCartNotFound}
	_, err = NewService(repo).Merge(context.Background(), userID, "used")
	testx.AssertTrue(t, errors.Is(err, ErrCartNotFound))
	testx.AssertEqual(t, err.Error(), "merge cart: cart not found")
	testx.AssertEqual(t, strings.Join(repo.calls, ","), "Merge")
}
