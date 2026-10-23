//go:build integration

package integration_test

import (
	"net/http"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/jwtx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/auth"
	"github.com/santekno/shop-app/apps/api/internal/config"
)

// TestRevocation_LastsOneAccessTokenLifetime: the revocation key of a
// logged-out session lives as long as APP_ACCESS_TOKEN_TTL, by when every
// access token of the session has expired on its own.
func TestRevocation_LastsOneAccessTokenLifetime(t *testing.T) {
	s := startServer(t, map[string]string{"APP_ACCESS_TOKEN_TTL": "5m"})
	_, p := s.newAccount(t, "ttl")
	if p.ExpiresIn > 300 {
		t.Fatalf("expires_in = %d with APP_ACCESS_TOKEN_TTL=5m", p.ExpiresIn)
	}
	if r := s.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": p.RefreshToken}, ""); r.Status != http.StatusNoContent {
		t.Fatalf("logout = %d", r.Status)
	}
	ttl, err := s.rdb.TTL(t.Context(), revokedKey(sessionOf(t, p.AccessToken))).Result()
	if err != nil || ttl < 4*time.Minute || ttl > 5*time.Minute {
		t.Errorf("revocation TTL = %s (err %v), want just under 5m", ttl, err)
	}
	if keys := s.redisKeys(t, "goshop:session-revoked:*"); len(keys) != 1 {
		t.Errorf("revocation keys = %v, want the one session", keys)
	}
}

// TestRevocation_AcrossInstances runs two API instances on one database and
// one Redis, as Railway does with replicas: a logout on one ends the
// session's access token on the other at the next request.
func TestRevocation_AcrossInstances(t *testing.T) {
	a := startServer(t, nil)
	b := startServer(t, map[string]string{"DATABASE_URL": a.dbURL, "REDIS_URL": os.Getenv("REDIS_URL")})
	_, p := a.newAccount(t, "dua-instans")

	if r := b.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken); r.Status != http.StatusOK {
		t.Fatalf("instance B refuses instance A's token: %d %s", r.Status, r.Body)
	}
	if r := a.call(t, http.MethodPost, "/v1/auth/logout", map[string]string{"refresh_token": p.RefreshToken}, ""); r.Status != http.StatusNoContent {
		t.Fatalf("logout on A = %d", r.Status)
	}
	assertError(t, b.call(t, http.MethodGet, "/v1/me", nil, p.AccessToken), http.StatusUnauthorized, "UNAUTHORIZED")
	assertError(t, b.call(t, http.MethodPost, "/v1/auth/refresh", map[string]string{"refresh_token": p.RefreshToken}, ""),
		http.StatusUnauthorized, "TOKEN_INVALID")
}

// TestRedis_Unreachable serves the app on a Redis client that cannot
// connect. The API fails closed: /readyz is 503 on the redis check (the
// error text only in development), an authenticated request is a 500
// rather than letting a possibly revoked token through, a rate-limited
// endpoint is a 500 rather than skipping its limit, and the public catalog
// and liveness still answer.
func TestRedis_Unreachable(t *testing.T) {
	for _, env := range []string{config.EnvDevelopment, config.EnvProduction} {
		t.Run(env, func(t *testing.T) {
			addr := closedAddr(t)
			rdb := redis.NewClient(&redis.Options{Addr: addr, DialTimeout: 200 * time.Millisecond, MaxRetries: -1})
			t.Cleanup(func() { _ = rdb.Close() })
			dsn, db := newTestDB(t)
			s := startServerWith(t, map[string]string{"APP_ENV": env, "DATABASE_URL": dsn}, nil, rdb)
			s.db = db

			resp := s.get(t, "/readyz")
			if resp.Status != http.StatusServiceUnavailable {
				t.Fatalf("GET /readyz = %d, want 503: %s", resp.Status, resp.Body)
			}
			status, checks := assertHealthBody(t, resp, "/readyz")
			if status != "unavailable" || jsonString(t, checks["redis"]["status"]) != "unavailable" ||
				jsonString(t, checks["postgres"]["status"]) != "ok" {
				t.Errorf("/readyz = %s, want redis unavailable and postgres ok", resp.Body)
			}
			_, hasText := checks["redis"]["error"]
			if hasText != (env == config.EnvDevelopment) || (env != config.EnvDevelopment && strings.Contains(string(resp.Body), addr)) {
				t.Errorf("%s /readyz error text shown = %v: %s", env, hasText, resp.Body)
			}

			now := time.Now().Truncate(time.Second)
			token := signAccess(t, []byte(testJWTSecret), jwtx.Claims{
				Subject: uuidx.NewV7(), Issuer: auth.Issuer, Audience: []string{auth.Audience}, IssuedAt: now,
				ExpiresAt: now.Add(5 * time.Minute), ID: uuidx.NewV7(),
				Extra: map[string]any{"role": "buyer", "sid": uuidx.NewV7()},
			})
			for _, r := range []response{
				s.call(t, http.MethodGet, "/v1/me", nil, token),
				s.call(t, http.MethodPost, "/v1/auth/login", map[string]string{"email": uniqueEmail("x"), "password": testPassword}, ""),
				s.call(t, http.MethodPost, "/v1/auth/register", map[string]string{"email": uniqueEmail("x"), "password": testPassword, "name": "X"}, ""),
			} {
				assertError(t, r, http.StatusInternalServerError, "INTERNAL_ERROR")
				if strings.Contains(string(r.Body), addr) || strings.Contains(string(r.Body), "redis") {
					t.Errorf("the 500 body reveals the Redis error: %s", r.Body)
				}
			}
			if n := s.count(t, `SELECT count(*) FROM users`); n != 0 {
				t.Errorf("a registration went through without its rate limit: %d users", n)
			}
			if r := s.get(t, "/v1/categories"); r.Status != http.StatusOK {
				t.Errorf("GET /v1/categories = %d, want the catalog to work without Redis", r.Status)
			}
			if r := s.get(t, "/healthz"); r.Status != http.StatusOK {
				t.Errorf("GET /healthz = %d, want liveness without Redis", r.Status)
			}
		})
	}
}
