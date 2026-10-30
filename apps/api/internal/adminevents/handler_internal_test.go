package adminevents

import (
	"testing"
	"time"

	"github.com/santekno/sdk/testx"
)

func TestFrameOf(t *testing.T) {
	tests := []struct {
		name, payload, want, wantErr string
	}{
		{name: "an order", payload: `{"id":"e1","event":"order","data":{"type":"order.paid"}}`,
			want: "id: e1\nevent: order\ndata: {\"type\":\"order.paid\"}\n\n"},
		{name: "data compacted to one line", payload: "{\"id\":\"e1\",\"event\":\"order\",\"data\":{\n\"a\" : 1\n}}",
			want: "id: e1\nevent: order\ndata: {\"a\":1}\n\n"},
		{name: "data that is a string", payload: `{"id":"e1","event":"order","data":"line\nbreak"}`,
			want: "id: e1\nevent: order\ndata: \"line\\nbreak\"\n\n"},
		{name: "not JSON", payload: `nope`, wantErr: "decode message: "},
		{name: "no id", payload: `{"event":"order","data":{}}`, wantErr: `message "": id and event must be one non-empty line`},
		{name: "no event", payload: `{"id":"e1","data":{}}`, wantErr: `message "e1": id and event must be one non-empty line`},
		{name: "a line break in the id", payload: `{"id":"e1\nevent: x","event":"order","data":{}}`, wantErr: "id and event must be one non-empty line"},
		{name: "a carriage return in the event", payload: `{"id":"e1","event":"order\rx","data":{}}`, wantErr: "id and event must be one non-empty line"},
		{name: "no data", payload: `{"id":"e1","event":"order"}`, wantErr: "message e1: data: "},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := frameOf(tt.payload)
			if tt.wantErr != "" {
				testx.AssertError(t, err)
				testx.AssertContains(t, err.Error(), tt.wantErr)
				testx.AssertEqual(t, got, "")
				return
			}
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, got, tt.want)
		})
	}
}

// The per-user count goes up to MaxStreamsPerUser, back down on release,
// and a user without streams leaves no entry behind (the map would
// otherwise grow with every account that ever opened one).
func TestHandler_AcquireRelease(t *testing.T) {
	h := NewHandler(nil, time.Now)
	for i := range MaxStreamsPerUser {
		testx.AssertTrue(t, h.acquire("a"), "stream %d", i+1)
	}
	testx.AssertFalse(t, h.acquire("a"), "one over the cap")
	testx.AssertTrue(t, h.acquire("b"), "another user")
	testx.AssertEqual(t, h.open["a"], MaxStreamsPerUser, "a refused acquire does not count")

	h.release("a")
	testx.AssertEqual(t, h.open["a"], MaxStreamsPerUser-1)
	testx.AssertTrue(t, h.acquire("a"), "a slot freed")

	for range MaxStreamsPerUser {
		h.release("a")
	}
	h.release("b")
	_, ok := h.open["a"]
	testx.AssertFalse(t, ok, "no entry for a user without streams")
	testx.AssertEqual(t, len(h.open), 0)
}

func TestNewHandler_Defaults(t *testing.T) {
	h := NewHandler(nil, time.Now)
	testx.AssertEqual(t, h.heartbeat, Heartbeat)
	testx.AssertTrue(t, h.WithHeartbeat(time.Second) == h, "WithHeartbeat returns h")
	testx.AssertEqual(t, h.heartbeat, time.Second)
}
