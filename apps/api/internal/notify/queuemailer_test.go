package notify

// Bab 6 artikel 08: with SMTP on, the API queues its emails for the worker.

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/hibiken/asynq"
	"github.com/santekno/sdk/testx"

	"github.com/santekno/shop-app/apps/api/internal/mail"
)

func TestQueueMailer_Send(t *testing.T) {
	msg := mail.Message{To: "budi@example.com", Subject: "Atur ulang kata sandi", Body: "token: abc.def"}

	t.Run("queues the message for the worker", func(t *testing.T) {
		client, rdb := newFakeAsynq(t)
		testx.AssertNoError(t, NewQueueMailer(client).Send(t.Context(), msg))
		calls := rdb.enqueues()
		testx.AssertEqual(t, len(calls), 1)
		m := decodeTaskMessage(t, calls[0].argv[0])
		testx.AssertEqual(t, m.Type, TypeSendEmail)
		testx.AssertEqual(t, m.Queue, "default")
		testx.AssertEqual(t, m.Retry, uint64(8))
		testx.AssertEqual(t, m.Timeout, uint64(60))
		// The token is deleted from Redis once sent: no retention.
		testx.AssertEqual(t, m.Retention, uint64(0))
		testx.AssertFalse(t, m.fields[12], "retention is set")
		var got mail.Message
		testx.AssertNoError(t, json.Unmarshal(m.Payload, &got))
		testx.AssertEqual(t, got, msg)

		// What the worker's SendQueued reads back.
		mailer := &recordingMailer{}
		testx.AssertNoError(t, NewEmails(mailer, nil, nil).SendQueued(t.Context(), asynq.NewTask(TypeSendEmail, m.Payload)))
		testx.AssertEqual(t, len(mailer.sent), 1)
		testx.AssertEqual(t, mailer.sent[0], msg)
	})
	t.Run("each message is its own task", func(t *testing.T) {
		client, rdb := newFakeAsynq(t)
		q := NewQueueMailer(client)
		testx.AssertNoError(t, q.Send(t.Context(), msg))
		testx.AssertNoError(t, q.Send(t.Context(), msg))
		calls := rdb.enqueues()
		testx.AssertEqual(t, len(calls), 2)
		testx.AssertNotEqual(t, decodeTaskMessage(t, calls[0].argv[0]).ID, decodeTaskMessage(t, calls[1].argv[0]).ID)
	})
	t.Run("the enqueue fails", func(t *testing.T) {
		client, _ := newFakeAsynq(t, enqueueAnswer{err: errors.New("OOM command not allowed")})
		err := NewQueueMailer(client).Send(t.Context(), msg)
		testx.AssertError(t, err)
		testx.AssertTrue(t, strings.HasPrefix(err.Error(), "queue email: "), "err = %v", err)
		testx.AssertContains(t, err.Error(), "OOM command not allowed")
		testx.AssertFalse(t, strings.Contains(err.Error(), "abc.def"), "the token leaks: %v", err)
	})
}
