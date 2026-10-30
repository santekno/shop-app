package outbox

import (
	"context"
	"errors"
	"strconv"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// namedPublisher appends its name to a shared log and fails with err.
type namedPublisher struct {
	name string
	log  *[]string
	err  error
}

func (p namedPublisher) Publish(_ context.Context, e Event) error {
	*p.log = append(*p.log, p.name+":"+e.ID)
	return p.err
}

// Publishers publishes to each publisher in turn and stops at the first
// failure, returning it as it is, so the dispatcher retries the event.
func TestPublishers(t *testing.T) {
	queueDown := errors.New("queue down")
	feedDown := errors.New("feed down")
	tests := []struct {
		name    string
		errs    []error // one publisher per entry
		wantLog string
		wantErr error
	}{
		{name: "none", errs: nil, wantLog: ""},
		{name: "one", errs: []error{nil}, wantLog: "p0:e-1"},
		{name: "all succeed, in order", errs: []error{nil, nil, nil}, wantLog: "p0:e-1,p1:e-1,p2:e-1"},
		{name: "the first fails: the rest never see it", errs: []error{queueDown, nil}, wantLog: "p0:e-1", wantErr: queueDown},
		{name: "the last fails: the first saw it", errs: []error{nil, feedDown}, wantLog: "p0:e-1,p1:e-1", wantErr: feedDown},
		{name: "the middle fails", errs: []error{nil, queueDown, nil}, wantLog: "p0:e-1,p1:e-1", wantErr: queueDown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			var log []string
			var ps Publishers
			for i, err := range tt.errs {
				ps = append(ps, namedPublisher{name: "p" + strconv.Itoa(i), log: &log, err: err})
			}
			err := ps.Publish(context.Background(), Event{ID: "e-1"})
			testx.AssertEqual(t, strings.Join(log, ","), tt.wantLog)
			testx.AssertTrue(t, errors.Is(err, tt.wantErr), "err = %v, want %v", err, tt.wantErr)
			if tt.wantErr != nil {
				testx.AssertEqual(t, err.Error(), tt.wantErr.Error(), "returned as it is, not wrapped")
			}
		})
	}
}

// The dispatcher with Publishers: an event the second publisher refuses
// stays pending, and its next run publishes it to both again (at least
// once).
func TestPublishers_InTheDispatcher(t *testing.T) {
	db := newFakeSQL().on("ClaimOutboxEvents", eventRows(1, 1))
	queue, feed := &recordingPublisher{}, &recordingPublisher{failOn: "e-1"}
	n, err := dispatcher(t, db, Publishers{queue, feed}).PublishPending(context.Background())

	testx.AssertEqual(t, n, 0, "nothing published")
	testx.AssertTrue(t, errors.Is(err, errBoom), "err = %v", err)
	testx.AssertEqual(t, strings.Join(queue.seen, ","), "e-1", "the queue saw it before the feed failed")
	testx.AssertEqual(t, len(feed.seen), 0)
	testx.AssertEqual(t, err.Error(), "publish outbox event: boom")
	testx.AssertEqual(t, strings.Join(db.names(), ","), "BEGIN,ClaimOutboxEvents,COMMIT", "not marked: it is tried again")
}

var _ Publisher = Publishers(nil)
