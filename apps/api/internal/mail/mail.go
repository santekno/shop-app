// Package mail sends email. Bab 4 only needs the Mailer interface and a
// development implementation that writes messages to the log; real SMTP
// (and sending from the worker) arrives in Bab 6 behind the same interface.
package mail

import (
	"context"

	"github.com/santekno/sdk/logx"
)

// Message is one plain-text email.
type Message struct {
	To      string
	Subject string
	Body    string
}

// Mailer sends email. Code that sends mail depends on this interface, so a
// test can record messages instead of sending them.
type Mailer interface {
	Send(ctx context.Context, m Message) error
}

// LogMailer "sends" email by logging it. With showBody (development only)
// the log line holds the recipient and the whole body, tokens included, so
// a developer can copy a verification or reset token from the API's
// output. Without it, only the subject is logged: a body with a token, or
// an address, must never reach a staging or production log.
type LogMailer struct {
	logger   logx.Logger
	showBody bool
}

// NewLogMailer returns a LogMailer writing to logger.
func NewLogMailer(logger logx.Logger, showBody bool) *LogMailer {
	return &LogMailer{logger: logger, showBody: showBody}
}

// Send implements Mailer. It never fails.
func (m *LogMailer) Send(ctx context.Context, msg Message) error {
	log := m.logger.WithContext(ctx)
	if !m.showBody {
		log.Warn("email not sent: no mail provider is configured until Bab 6", "subject", msg.Subject)
		return nil
	}
	log.Info("email (development: logged, not sent)", "to", msg.To, "subject", msg.Subject, "body", msg.Body)
	return nil
}
