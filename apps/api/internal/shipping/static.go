package shipping

import "context"

// Static prices every parcel from a fixed table: a rate per started
// kilogram for each courier service, whatever the origin and destination.
// It needs no network and gives the same answer every time, so development,
// tests and load tests never depend on a courier API. It is also a fair
// "flat rate" for a shop that does not want a live courier API (ADR 0006).
type Static struct{}

// staticRate is one row of the table.
type staticRate struct {
	courier     Courier
	courierName string
	service     string
	serviceName string
	perKilogram int64
	etd         string
}

var staticRates = []staticRate{
	{CourierJNE, "JNE", "REG", "Reguler", 10000, "2-3 days"},
	{CourierJNE, "JNE", "YES", "Yakin Esok Sampai", 18000, "1 day"},
	{CourierJNT, "J&T Express", "EZ", "Regular", 10000, "2-3 days"},
	{CourierSiCepat, "SiCepat", "REG", "Reguler", 9000, "2-3 days"},
	{CourierSiCepat, "SiCepat", "BEST", "Besok Sampai Tujuan", 17000, "1 day"},
}

// Name implements Provider.
func (Static) Name() string { return "static" }

// Quote implements Provider: the rate times the started kilograms (1 001
// grams is 2 kg), at least one kilogram.
func (Static) Quote(_ context.Context, req Request) ([]Quote, error) {
	kilograms := max(1, (req.WeightGrams+999)/1000)
	quotes := make([]Quote, 0, len(staticRates))
	for _, r := range staticRates {
		quotes = append(quotes, Quote{
			Courier: r.courier, CourierName: r.courierName, Service: r.service, ServiceName: r.serviceName,
			Price: r.perKilogram * kilograms, ETD: r.etd,
		})
	}
	sortByPrice(quotes)
	return quotes, nil
}
