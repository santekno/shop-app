// Package imaging makes the storefront's copies of a product photo (ADR
// 0007): JPEGs of fixed widths, resized in pure Go with golang.org/x/image
// (no cgo, so the worker's image stays static and distroless), turned as
// the photo's EXIF orientation says. Re-encoding also drops the original's
// metadata, such as a phone photo's GPS position.
package imaging

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png" // the formats an upload may have
	"io"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"
)

// Widths are the variants' widths in pixels, narrowest first: enough for
// a product card (400) and a product page on a phone at 2x (800).
var Widths = []int{400, 800}

// Quality is the JPEG quality: visually clean for photos at a fraction of
// the size of 100.
const Quality = 82

// ErrUndecodable means the file is not an image Decode can read. Retrying
// does not help.
var ErrUndecodable = errors.New("image cannot be decoded")

// Variant is one resized copy, encoded as JPEG.
type Variant struct {
	Width  int
	Height int
	JPEG   []byte
}

// Resize decodes r (JPEG, PNG or WebP) and returns one JPEG per width in
// widths that is narrower than the original, plus the original's width
// when the original is narrower than the widest one, so a small photo is
// never enlarged and always has at least one variant. maxPixels bounds the
// decoded bitmap: a larger image is ErrUndecodable before it is decoded.
func Resize(r io.Reader, widths []int, maxPixels int) ([]Variant, error) {
	// The whole file (the caller bounds it), so the EXIF orientation can
	// be read before decoding.
	data, err := io.ReadAll(r)
	if err != nil {
		return nil, fmt.Errorf("read image: %w", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUndecodable, err)
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxPixels {
		return nil, fmt.Errorf("%w: %dx%d pixels", ErrUndecodable, cfg.Width, cfg.Height)
	}
	src, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrUndecodable, err)
	}
	o := orientation(data)
	displayWidth := src.Bounds().Dx()
	if swapsSides(o) {
		displayWidth = src.Bounds().Dy()
	}
	var out []Variant
	for _, w := range targetWidths(displayWidth, widths) {
		v, err := encode(src, w, o)
		if err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, nil
}

// targetWidths is the widths to make for an original of width: the ones
// narrower than it, and the original's own width when it is narrower than
// the widest.
func targetWidths(width int, widths []int) []int {
	var out []int
	for _, w := range widths {
		if w < width {
			out = append(out, w)
		}
	}
	if len(widths) > 0 && width <= widths[len(widths)-1] {
		out = append(out, width)
	}
	return out
}

// encode scales src to width as displayed (keeping its aspect ratio) onto
// white, which is what a transparent PNG looks like on the storefront,
// turns it as orientation o says, and encodes it.
func encode(src image.Image, width, o int) (Variant, error) {
	b := src.Bounds()
	dw, dh := b.Dx(), b.Dy() // as displayed
	if swapsSides(o) {
		dw, dh = dh, dw
	}
	height := max(1, dh*width/dw)
	// Scaled as stored, then turned: the turn runs on the small image.
	sw, sh := width, height
	if swapsSides(o) {
		sw, sh = height, width
	}
	scaled := image.NewRGBA(image.Rect(0, 0, sw, sh))
	draw.Draw(scaled, scaled.Bounds(), image.NewUniform(color.White), image.Point{}, draw.Src)
	// Catmull-Rom: sharp downscaling, the slowest of x/image's scalers but
	// still well under a second for a 24-megapixel photo.
	draw.CatmullRom.Scale(scaled, scaled.Bounds(), src, b, draw.Over, nil)
	dst := orient(scaled, o)
	var out bytes.Buffer
	if err := jpeg.Encode(&out, dst, &jpeg.Options{Quality: Quality}); err != nil {
		return Variant{}, fmt.Errorf("encode %dpx jpeg: %w", width, err)
	}
	return Variant{Width: width, Height: height, JPEG: out.Bytes()}, nil
}
