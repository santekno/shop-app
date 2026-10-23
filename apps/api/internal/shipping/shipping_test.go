package shipping

import (
	"context"
	"testing"

	"github.com/santekno/sdk/testx"
)

func TestCourier_Valid(t *testing.T) {
	for _, c := range []Courier{CourierJNE, CourierJNT, CourierSiCepat} {
		testx.AssertTrue(t, c.Valid(), "%s", c)
	}
	for _, c := range []Courier{"", "JNE", "pos", "anteraja"} {
		testx.AssertFalse(t, c.Valid(), "%q", c)
	}
}

func TestFind(t *testing.T) {
	quotes := []Quote{
		{Courier: CourierJNE, Service: "REG", Price: 10000},
		{Courier: CourierJNE, Service: "YES", Price: 18000},
		{Courier: CourierSiCepat, Service: "REG", Price: 9000},
	}
	q, ok := Find(quotes, CourierSiCepat, "REG")
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, q.Price, int64(9000), "the courier and the service both match")
	q, ok = Find(quotes, CourierJNE, "YES")
	testx.AssertTrue(t, ok)
	testx.AssertEqual(t, q.Price, int64(18000))

	for _, miss := range []struct {
		c Courier
		s string
	}{{CourierJNT, "REG"}, {CourierJNE, "reg"}, {CourierJNE, ""}, {"", "REG"}} {
		q, ok := Find(quotes, miss.c, miss.s)
		testx.AssertFalse(t, ok, "%s %s", miss.c, miss.s)
		testx.AssertEqual(t, q, Quote{})
	}
	_, ok = Find(nil, CourierJNE, "REG")
	testx.AssertFalse(t, ok)
}

func TestSortByPrice(t *testing.T) {
	quotes := []Quote{
		{Courier: CourierSiCepat, Service: "REG", Price: 10000},
		{Courier: CourierJNT, Service: "EZ", Price: 9000},
		{Courier: CourierJNE, Service: "YES", Price: 10000},
		{Courier: CourierJNE, Service: "REG", Price: 10000},
	}
	sortByPrice(quotes)
	var got []string
	for _, q := range quotes {
		got = append(got, string(q.Courier)+"/"+q.Service)
	}
	testx.AssertEqual(t, len(got), 4)
	testx.AssertEqual(t, got[0], "jnt/EZ", "cheapest first")
	testx.AssertEqual(t, got[1], "jne/REG", "then by courier, then by service")
	testx.AssertEqual(t, got[2], "jne/YES")
	testx.AssertEqual(t, got[3], "sicepat/REG")
}

func TestStatic(t *testing.T) {
	testx.AssertEqual(t, Static{}.Name(), "static")
	tests := []struct {
		grams int64
		kg    int64
	}{
		{grams: 0, kg: 1},
		{grams: 1, kg: 1},
		{grams: 1000, kg: 1},
		{grams: 1001, kg: 2},
		{grams: 2000, kg: 2},
		{grams: 2001, kg: 3},
		{grams: -5, kg: 1},
	}
	for _, tt := range tests {
		quotes, err := Static{}.Quote(context.Background(), Request{WeightGrams: tt.grams, OriginPostalCode: "x", DestinationPostalCode: "y"})
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(quotes), 5)
		q, ok := Find(quotes, CourierJNE, "REG")
		testx.AssertTrue(t, ok)
		testx.AssertEqual(t, q.Price, 10000*tt.kg, "%d g is %d kg", tt.grams, tt.kg)
		q, _ = Find(quotes, CourierSiCepat, "BEST")
		testx.AssertEqual(t, q.Price, 17000*tt.kg)
	}

	quotes, _ := Static{}.Quote(context.Background(), Request{WeightGrams: 500})
	testx.AssertEqual(t, quotes[0], Quote{Courier: CourierSiCepat, CourierName: "SiCepat", Service: "REG", ServiceName: "Reguler", Price: 9000, ETD: "2-3 days"})
	for i := 1; i < len(quotes); i++ {
		testx.AssertTrue(t, quotes[i-1].Price <= quotes[i].Price, "cheapest first: %v", quotes)
	}
	for _, q := range quotes {
		testx.AssertTrue(t, q.Courier.Valid(), "%s", q.Courier)
	}
	// The same answer every time, whatever the addresses.
	again, _ := Static{}.Quote(context.Background(), Request{WeightGrams: 500, OriginPostalCode: "99999", DestinationPostalCode: "10110"})
	testx.AssertEqual(t, len(again), len(quotes))
	for i := range quotes {
		testx.AssertEqual(t, again[i], quotes[i])
	}
}
