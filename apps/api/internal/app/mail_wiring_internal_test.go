package app

import (
	"context"
	"strings"
	"testing"

	"github.com/redis/go-redis/v9"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/config"
	"github.com/santekno/shop-app/apps/api/internal/mail"
	"github.com/santekno/shop-app/apps/api/internal/notify"
)

func smtpConfig() config.SMTP {
	return config.SMTP{Host: "smtp.example.test", Port: 587, Username: "goshop", Password: "smtp-password", From: "GoShop <no-reply@shop.test>"}
}

func TestWorkerMailer(t *testing.T) {
	logger, _ := jsonLogger()
	m := WorkerMailer(config.Config{Env: config.EnvProduction}, logger)
	_, isLog := m.(*mail.LogMailer)
	testx.AssertTrue(t, isLog, "no SMTP_HOST: the log, got %T", m)

	m = WorkerMailer(config.Config{Env: config.EnvProduction, SMTP: smtpConfig()}, logger)
	_, isSMTP := m.(*mail.SMTPMailer)
	testx.AssertTrue(t, isSMTP, "SMTP_HOST set: SMTP, got %T", m)
}

// The API never talks to the mail server itself: with SMTP on it queues
// the email for the worker.
func TestAPIMailer(t *testing.T) {
	logger, logs := jsonLogger()
	rdb := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	t.Cleanup(func() { _ = rdb.Close() })

	m := apiMailer(config.Config{Env: config.EnvProduction, SMTP: smtpConfig()}, logger, rdb)
	_, queued := m.(*notify.QueueMailer)
	testx.AssertTrue(t, queued, "SMTP_HOST set: the queue, got %T", m)

	m = apiMailer(config.Config{Env: config.EnvProduction}, logger, rdb)
	_, isLog := m.(*mail.LogMailer)
	testx.AssertTrue(t, isLog, "no SMTP_HOST: the log, got %T", m)
	// Outside development the log mailer never writes the body (a token).
	testx.AssertNoError(t, m.Send(context.Background(), mail.Message{To: "buyer@example.com", Subject: "Verify", Body: "token=vrf-123"}))
	testx.AssertFalse(t, strings.Contains(logs.String(), "vrf-123"), "the body was logged: %s", logs.String())
}
