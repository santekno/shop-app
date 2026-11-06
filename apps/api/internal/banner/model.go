// Package banner is the storefront's banner carousel (Bab 14): the coloured
// cards at the top of the mobile home screen. Banners are written by the
// seed or by SQL; this package only reads them.
package banner

// Banner is one card of the carousel.
type Banner struct {
	ID    string
	Title string
	// Subtitle and CTALabel are empty when the banner has none.
	Subtitle string
	CTALabel string
	// LinkCategorySlug is the category the app opens when the banner is
	// tapped; empty for a banner that links nowhere.
	LinkCategorySlug string
	// BackgroundColor is "#RRGGBB".
	BackgroundColor string
}
