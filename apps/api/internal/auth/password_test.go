package auth

import (
	"context"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/santekno/sdk/hashx"
	"github.com/santekno/sdk/testx"
)

func TestCheckPassword(t *testing.T) {
	const lengthReason = "must be between 8 and 128 characters"
	tests := []struct {
		name       string
		password   string
		wantReason string // "" means accepted
	}{
		{name: "eight characters", password: "kopi-tub", wantReason: ""},
		{name: "seven characters", password: "kopitub", wantReason: lengthReason},
		{name: "empty", password: "", wantReason: lengthReason},
		{name: "128 characters", password: strings.Repeat("a", 127) + "b", wantReason: ""},
		{name: "129 characters", password: strings.Repeat("a", 128) + "b", wantReason: lengthReason},
		// Length is counted in characters: eight runes are 24 bytes here,
		// and 128 three-byte runes (384 bytes) are still accepted.
		{name: "multibyte counted as characters", password: "かぎかぎかぎかぎ", wantReason: ""},     //nolint:gosec // a test value, not a credential
		{name: "seven multibyte characters", password: "かぎかぎかぎか", wantReason: lengthReason}, //nolint:gosec // a test value, not a credential
		{name: "128 multibyte characters", password: strings.Repeat("鍵", 128), wantReason: ""},
		{name: "129 multibyte characters", password: strings.Repeat("鍵", 129), wantReason: lengthReason},
		{name: "only spaces", password: "          ", wantReason: "must not be only spaces"},
		{name: "only tabs and newlines", password: "\t\t\t\n\n\n\t\t", wantReason: "must not be only spaces"},
		{name: "spaces inside are fine", password: "kopi susu gula aren", wantReason: ""}, //nolint:gosec // a test value, not a credential
		{name: "common", password: "password123", wantReason: "is too common; choose one that is not on a list of leaked passwords"},
		{name: "common, any case", password: "PassWord123", wantReason: "is too common; choose one that is not on a list of leaked passwords"},
		{name: "common Indonesian", password: "Bismillah", wantReason: "is too common; choose one that is not on a list of leaked passwords"},
		{name: "common with a space is not on the list", password: "password 123", wantReason: ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := CheckPassword(tt.password)
			if tt.wantReason == "" {
				testx.AssertNoError(t, err)
				return
			}
			var pwErr *PasswordError
			if !errors.As(err, &pwErr) {
				t.Fatalf("CheckPassword(%q) = %v, want a *PasswordError", tt.password, err)
			}
			testx.AssertEqual(t, pwErr.Reason, tt.wantReason)
			testx.AssertEqual(t, err.Error(), "password "+tt.wantReason)
			if tt.password != "" {
				testx.AssertFalse(t, strings.Contains(err.Error(), tt.password), "the message repeats the password")
			}
		})
	}
}

func TestPasswordLimits(t *testing.T) {
	// The documented policy; a changed constant is a visible decision.
	testx.AssertEqual(t, MinPasswordLength, 8)
	testx.AssertEqual(t, MaxPasswordLength, 128)
	testx.AssertEqual(t, DefaultMaxConcurrentHashes, 4)
}

func TestNormalizeEmail(t *testing.T) {
	tests := []struct{ in, want string }{
		{in: "budi@example.com", want: "budi@example.com"},
		{in: "  Budi@Example.COM\t", want: "budi@example.com"},
		{in: "", want: ""},
		{in: "   ", want: ""},
	}
	for _, tt := range tests {
		testx.AssertEqual(t, NormalizeEmail(tt.in), tt.want, "NormalizeEmail(%q)", tt.in)
	}
}

func TestIsASCII(t *testing.T) {
	testx.AssertTrue(t, isASCII(""))
	testx.AssertTrue(t, isASCII("budi@example.com"))
	testx.AssertTrue(t, isASCII("\x7f"))
	testx.AssertFalse(t, isASCII("büdi@example.com"))
	testx.AssertFalse(t, isASCII("budi@examplе.com"), "a Cyrillic e")
}

func TestNewArgon2Hasher(t *testing.T) {
	// One hasher per case costs one argon2id hash (its dummy); keep it small.
	tests := []struct {
		name string
		n    int
		want int
	}{
		{name: "zero means the default", n: 0, want: DefaultMaxConcurrentHashes},
		{name: "negative means the default", n: -3, want: DefaultMaxConcurrentHashes},
		{name: "one", n: 1, want: 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewArgon2Hasher(tt.n)
			testx.AssertEqual(t, cap(h.slots), tt.want)
			// The dummy is made at construction, so the first login for an
			// unknown email costs no more than the others.
			testx.AssertTrue(t, strings.HasPrefix(h.dummy, "$argon2id$"), "dummy hash %q", h.dummy)
		})
	}
}

func TestArgon2Hasher_HashAndVerify(t *testing.T) {
	h := NewArgon2Hasher(2)
	ctx := context.Background()

	hash, err := h.Hash(ctx, "kopi susu gula aren")
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(hash, "$argon2id$v=19$m=65536,t=3,p=4$"), "parameters are encoded: %q", hash)
	testx.AssertFalse(t, strings.Contains(hash, "kopi"), "the hash contains the password")

	ok, err := h.Verify(ctx, "kopi susu gula aren", hash)
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, ok, "the right password")

	ok, err = h.Verify(ctx, "kopi susu gula arem", hash)
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok, "a wrong password")

	ok, err = h.Verify(ctx, "anything", "not-a-hash")
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok, "a malformed hash")

	_, err = h.Hash(ctx, "")
	testx.AssertError(t, err, "hashx refuses an empty password")
	testx.AssertContains(t, err.Error(), "hash password: ")

	// Every slot is free again after these calls.
	testx.AssertEqual(t, len(h.slots), 0)
}

// An empty hash (unknown email, account without a password) is checked
// against the dummy, and never logs anyone in, even with the dummy's own
// password.
func TestArgon2Hasher_VerifyEmptyHashUsesDummy(t *testing.T) {
	const known = "the-dummy-password-in-this-test"
	dummy, err := hashx.HashPassword(known)
	testx.AssertNoError(t, err)
	h := &Argon2Hasher{slots: make(chan struct{}, 1), dummy: dummy}

	ok, err := h.Verify(context.Background(), known, "")
	testx.AssertNoError(t, err)
	testx.AssertFalse(t, ok, "a match against the dummy must not log in")

	// The dummy path does the work: it waits for a slot like a real
	// verification, so with every slot taken it gives up with the context.
	h.slots <- struct{}{}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancel()
	ok, err = h.Verify(ctx, known, "")
	testx.AssertFalse(t, ok)
	testx.AssertTrue(t, errors.Is(err, context.DeadlineExceeded), "err = %v", err)
}

func TestArgon2Hasher_WaitsForASlot(t *testing.T) {
	h := &Argon2Hasher{slots: make(chan struct{}, 2), dummy: "unused"}
	// Two hashes are "running".
	h.slots <- struct{}{}
	h.slots <- struct{}{}

	t.Run("gives up when the request ends", func(t *testing.T) {
		ctx, cancel := context.WithCancel(context.Background())
		cancel()
		_, err := h.Hash(ctx, "kopi susu gula aren")
		testx.AssertTrue(t, errors.Is(err, context.Canceled), "Hash err = %v", err)
		ok, err := h.Verify(ctx, "kopi susu gula aren", "$argon2id$x")
		testx.AssertFalse(t, ok)
		testx.AssertTrue(t, errors.Is(err, context.Canceled), "Verify err = %v", err)
		testx.AssertEqual(t, len(h.slots), 2, "a cancelled wait takes no slot")
	})

	t.Run("goes on when a slot frees", func(t *testing.T) {
		done := make(chan error, 1)
		go func() {
			_, err := h.Hash(context.Background(), "kopi susu gula aren")
			done <- err
		}()
		select {
		case err := <-done:
			t.Fatalf("Hash ran with every slot taken (err %v)", err)
		case <-time.After(30 * time.Millisecond):
		}
		<-h.slots // one running hash finishes
		select {
		case err := <-done:
			testx.AssertNoError(t, err)
		case <-time.After(10 * time.Second):
			t.Fatal("Hash did not run after a slot was freed")
		}
		testx.AssertEqual(t, len(h.slots), 1, "the slot is released after the hash")
	})
}

// Every hash goes through the semaphore: while six compete for two slots,
// the watcher sees hashes holding slots, never more than n, and every slot
// is returned at the end.
func TestArgon2Hasher_BoundsConcurrency(t *testing.T) {
	const n = 2
	h := &Argon2Hasher{slots: make(chan struct{}, n)}

	var (
		mu      sync.Mutex
		running int
		peak    int
		wg      sync.WaitGroup
	)
	// Watch the semaphore while 6 hashes compete for it.
	stop := make(chan struct{})
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
				mu.Lock()
				running = len(h.slots)
				peak = max(peak, running)
				mu.Unlock()
			}
		}
	}()
	for range 6 {
		wg.Go(func() {
			_, err := h.Hash(context.Background(), "kopi susu gula aren")
			if err != nil {
				t.Errorf("Hash: %v", err)
			}
		})
	}
	wg.Wait()
	close(stop)
	mu.Lock()
	defer mu.Unlock()
	testx.AssertTrue(t, peak <= n, "peak concurrency %d, want at most %d", peak, n)
	testx.AssertTrue(t, peak >= 1, "the watcher saw no hash running")
	testx.AssertEqual(t, len(h.slots), 0)
}
