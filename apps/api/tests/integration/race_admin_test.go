//go:build integration

package integration_test

import (
	"cmp"
	"fmt"
	"net/http"
	"slices"
	"testing"

	"github.com/santekno/sdk/uuidx"
)

// The admin save races of ADR 0006 ("Lock order"): a seller's PUT that
// lists the variants in the form's order (here the reverse of their ids)
// against the paths that lock the same variants in id order. The save
// locks every variant of the product in id order before it writes, so none
// of them deadlocks (40P01, which the database audit reproduced before
// that lock existed); the save either wins or is 409 VERSION_CONFLICT.

// adminForm is the admin GET of a product, as a seller's form loads it.
func (sh *shop) adminForm(t *testing.T, productID string) adminProductOut {
	t.Helper()
	return assertAdminProduct(t, sh.staffCall(t, http.MethodGet, "/v1/admin/products/"+productID, nil).Body)
}

// reverseSave is the PUT body of form with its variants in descending id
// order, each with stock and its SKU plus skuSuffix, its weight and the
// version the form loaded.
func reverseSave(t *testing.T, form adminProductOut, stock int, skuSuffix string) string {
	t.Helper()
	vs := slices.Clone(form.Variants)
	slices.SortFunc(vs, func(a, b adminVariantOut) int { return cmp.Compare(b.ID, a.ID) })
	body := make([]map[string]any, 0, len(vs))
	for _, v := range vs {
		w := withVersion(variantJSON(v.ID, v.SKU+skuSuffix, v.Name, int(v.Price.Amount), stock), v.Version)
		// The same weight: a new weight would rightly make a checkout
		// that was quoted for the old one answer CART_CHANGED.
		w["weight_grams"] = v.WeightGrams
		body = append(body, w)
	}
	return productJSON(t, form.CategoryID, form.Slug, "active", body...)
}

// trySave sends the admin PUT of body.
func (sh *shop) trySave(productID, body string) (response, error) {
	return sh.tryCall(http.MethodPut, "/v1/admin/products/"+productID, body, sh.staff, nil)
}

// TestRace_ShopVersusAdminSave: a checkout, a buyer's cancel and the
// expiry job, each touching all three variants of a product, run at the
// same moment as a seller's save of that product with the form in reverse
// id order. No answer is 5xx and nothing deadlocks; the save is 200 or 409
// VERSION_CONFLICT; when it lost, the stock is exactly what the three
// orders left, and it is never negative.
func TestRace_ShopVersusAdminSave(t *testing.T) {
	sh := newShop(t, nil)
	bs := sh.buyers(t, "admin-balap", 3)
	tally := map[string]int{}
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-admin-balap-%d", i), variant(fmt.Sprintf("AB-%d-S", i), "S", 10000, 20),
			variant(fmt.Sprintf("AB-%d-M", i), "M", 10000, 20), variant(fmt.Sprintf("AB-%d-L", i), "L", 10000, 20))
		ids := make([]string, 0, 3)
		for _, id := range p.Variants {
			ids = append(ids, id)
		}
		slices.Sort(ids)
		all := func(b buyer) orderOut {
			lines := make([]line, 0, 3)
			for _, id := range ids {
				lines = append(lines, line{id, 1})
			}
			return sh.order(t, b, lines...)
		}
		toExpire := all(bs[0])
		sh.expireNow(t, toExpire.ID)
		toCancel := all(bs[1])
		for _, id := range slices.Backward(ids) {
			sh.add(t, bs[2], id, 2)
		}
		form := sh.adminForm(t, p.ID)
		save := reverseSave(t, form, 50, "")

		var expired int
		var expireErr error
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCheckout(bs[2].Token, uuidx.NewV7(), checkoutBody(bs[2].AddressID))
			},
			func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/orders/"+toCancel.ID+"/cancel", nil, bs[1].Token, nil)
			},
			func() (response, error) {
				expired, expireErr = sh.orders().ExpireDue(t.Context())
				return response{Status: http.StatusOK}, nil
			},
			func() (response, error) { return sh.trySave(p.ID, save) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if expireErr != nil || expired != 1 {
			t.Fatalf("iteration %d: ExpireDue = %d, %v; want 1 and no error", i, expired, expireErr)
		}
		if results[0].Status != http.StatusCreated || results[1].Status != http.StatusOK {
			t.Fatalf("iteration %d: checkout %s, cancel %s", i, describe(results[0]), describe(results[1]))
		}
		saved := results[3]
		key := "save " + fmt.Sprint(saved.Status)
		tally[key]++
		for _, id := range ids {
			s := sh.stock(t, id)
			switch {
			case saved.Status == http.StatusOK && s < 0:
				t.Fatalf("iteration %d: stock %d", i, s)
			case is(saved, http.StatusConflict, "VERSION_CONFLICT") && s != 18:
				t.Fatalf("iteration %d: stock %d after a refused save, want 20 - 2 (the expired and cancelled orders gave theirs back)", i, s)
			case saved.Status != http.StatusOK && !is(saved, http.StatusConflict, "VERSION_CONFLICT"):
				t.Fatalf("iteration %d: save = %s", i, describe(saved))
			}
		}
	}
	t.Logf("admin saves over %d iterations: %v", raceIterations, tally)
	assertNoServerErrors(t, sh.server)
}

// TestRace_MergeVersusSkuChange: a login merge writes new cart lines (each
// takes FOR KEY SHARE on its variant) while a seller's save changes the
// SKUs of those variants (FOR UPDATE, in id order). The merge writes in
// variant_id order, so both finish: 200 and 200, with every guest line in
// the user's cart and every SKU changed.
func TestRace_MergeVersusSkuChange(t *testing.T) {
	sh := newShop(t, nil)
	b := sh.buyer(t, "gabung-sku")
	for i := range raceIterations {
		sh.resetBuyers(t)
		p := sh.product(t, fmt.Sprintf("kaos-gabung-sku-%d", i), variant(fmt.Sprintf("GS-%d-S", i), "S", 10000, 20),
			variant(fmt.Sprintf("GS-%d-M", i), "M", 10000, 20), variant(fmt.Sprintf("GS-%d-L", i), "L", 10000, 20),
			variant(fmt.Sprintf("GS-%d-XL", i), "XL", 10000, 20))
		ids := make([]string, 0, len(p.Variants))
		for _, id := range p.Variants {
			ids = append(ids, id)
		}
		slices.Sort(ids)
		sh.add(t, b, ids[1], 1)
		token := ""
		for _, id := range slices.Backward(ids) {
			c := assertCart(t, sh.addItem(t, "", token, id, 2), "guest add")
			if c.Token != "" {
				token = c.Token
			}
		}
		save := reverseSave(t, sh.adminForm(t, p.ID), 20, "-BARU")
		results := runTogether(t,
			func() (response, error) {
				return sh.tryCall(http.MethodPost, "/v1/cart/merge", nil, b.Token, cartHeaders(token))
			},
			func() (response, error) { return sh.trySave(p.ID, save) })
		assertNo5xx(t, fmt.Sprintf("iteration %d", i), results...)
		if results[0].Status != http.StatusOK || results[1].Status != http.StatusOK {
			t.Fatalf("iteration %d: merge %s, save %s; want both 200", i, describe(results[0]), describe(results[1]))
		}
		c := assertCart(t, sh.cartReq(t, http.MethodGet, "/v1/cart", nil, b.Token, ""), "cart after the merge")
		want := map[string]int32{ids[0]: 2, ids[1]: 3, ids[2]: 2, ids[3]: 2}
		if fmt.Sprint(c.quantities()) != fmt.Sprint(want) {
			t.Fatalf("iteration %d: cart %v, want %v", i, c.quantities(), want)
		}
		if n := sh.count(t, `SELECT count(*) FROM product_variants WHERE product_id = $1 AND sku LIKE '%-BARU'`, p.ID); n != 4 {
			t.Fatalf("iteration %d: %d SKUs changed, want 4", i, n)
		}
	}
	assertNoServerErrors(t, sh.server)
}
