//go:build integration

package integration_test

import (
	"fmt"
	"net/http"
	"testing"

	"github.com/santekno/shop-app/apps/api/internal/auth"
)

// TestRace_GoogleFirstSignIn sends the first sign-in of one Google account
// twice at once (a double tap), raceIterations times. Both must sign in to
// the one account the first created: the losing insert fails on the email
// or the identity, and the service then finds the winner's account by
// Google's subject instead of answering 409 EMAIL_TAKEN.
func TestRace_GoogleFirstSignIn(t *testing.T) {
	g := &fakeGoogle{}
	s, _ := googleServer(t, g, withUnlimitedRate())
	for i := range raceIterations {
		idToken := fmt.Sprintf("double-%d", i)
		g.accept(idToken, auth.GoogleIdentity{Subject: "sub-" + idToken, Email: uniqueEmail(idToken), EmailVerified: true, Name: "Dobel"})
		signIn := func() (response, error) {
			return s.tryCall(http.MethodPost, "/v1/auth/google", map[string]string{"id_token": idToken}, "", nil)
		}
		results := runTogether(t, signIn, signIn)
		var users []string
		for k, r := range results {
			if r.Status != http.StatusOK {
				t.Fatalf("iteration %d: sign-in %d of a double tap = %d: %s", i, k, r.Status, r.Body)
			}
			users = append(users, decodeData[tokenPairOut](t, r.Body).User.ID)
		}
		if users[0] != users[1] {
			t.Errorf("iteration %d: a double tap signed in to two accounts %v", i, users)
		}
		if n := s.count(t, `SELECT count(*) FROM user_identities WHERE subject = $1`, "sub-"+idToken); n != 1 {
			t.Errorf("iteration %d: %d identities for one Google account, want 1", i, n)
		}
		if n := s.liveSessions(t, users[0]); n != 2 {
			t.Errorf("iteration %d: %d live sessions, want one per sign-in", i, n)
		}
	}
	assertNoServerErrors(t, s)
}
