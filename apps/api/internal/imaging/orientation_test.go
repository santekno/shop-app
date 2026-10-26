package imaging

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"strconv"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// Phone photos are stored as the sensor saw them, with the EXIF
// Orientation tag saying how to turn them (ADR 0007). The variants carry
// no EXIF, so the worker must turn them itself.

// tiff is a TIFF block (the EXIF payload after "Exif\0\0") in byte order
// bo ("II" little-endian, "MM" big-endian) whose first IFD holds the
// given (tag, value) SHORT entries.
func tiff(bo string, entries ...[2]uint16) []byte {
	var order binary.AppendByteOrder = binary.LittleEndian
	if bo == "MM" {
		order = binary.BigEndian
	}
	b := []byte(bo)
	b = order.AppendUint16(b, 42)
	b = order.AppendUint32(b, 8)                    // the first IFD right after the header
	b = order.AppendUint16(b, uint16(len(entries))) // #nosec G115 -- a few entries
	for _, e := range entries {
		b = order.AppendUint16(b, e[0]) // tag
		b = order.AppendUint16(b, 3)    // SHORT
		b = order.AppendUint32(b, 1)    // one value
		b = order.AppendUint16(b, e[1]) // the value, left-justified
		b = order.AppendUint16(b, 0)
	}
	return order.AppendUint32(b, 0) // no next IFD
}

// segment is a JPEG marker segment: 0xFF, marker, length, payload.
func segment(marker byte, payload []byte) []byte {
	s := []byte{0xFF, marker, 0, 0}
	binary.BigEndian.PutUint16(s[2:], uint16(len(payload)+2)) // #nosec G115 -- small
	return append(s, payload...)
}

// withSegments puts segs right after a JPEG's SOI, where a camera writes
// APP0 and APP1.
func withSegments(jpg []byte, segs ...[]byte) []byte {
	out := append([]byte{}, jpg[:2]...)
	for _, s := range segs {
		out = append(out, s...)
	}
	return append(out, jpg[2:]...)
}

func exif(t []byte) []byte { return segment(0xE1, append([]byte("Exif\x00\x00"), t...)) }

const tagOrientation = 0x0112

func TestOrientation(t *testing.T) {
	plain := encodeJPEG(t, gradient(8, 8))
	jfif := segment(0xE0, []byte("JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"))
	for o := uint16(1); o <= 8; o++ {
		for _, bo := range []string{"II", "MM"} {
			in := withSegments(plain, exif(tiff(bo, [2]uint16{tagOrientation, o})))
			testx.AssertEqual(t, orientation(in), int(o), "%s orientation %d", bo, o)
		}
	}
	tests := []struct {
		name string
		data []byte
		want int
	}{
		{"after an APP0 segment", withSegments(plain, jfif, exif(tiff("MM", [2]uint16{tagOrientation, 6}))), 6},
		{"after other tags", withSegments(plain, exif(tiff("II", [2]uint16{0x010F, 7}, [2]uint16{0x0110, 9}, [2]uint16{tagOrientation, 8}))), 8},
		{"no EXIF", plain, 1},
		{"not a JPEG", encodePNG(t, gradient(8, 8)), 1},
		{"empty", nil, 1},
		{"SOI only", []byte{0xFF, 0xD8}, 1},
		{"no orientation tag", withSegments(plain, exif(tiff("II", [2]uint16{0x010F, 6}))), 1},
		{"orientation 0", withSegments(plain, exif(tiff("II", [2]uint16{tagOrientation, 0}))), 1},
		{"orientation 9", withSegments(plain, exif(tiff("II", [2]uint16{tagOrientation, 9}))), 1},
		{"unknown byte order", withSegments(plain, exif(append([]byte("XX"), tiff("II", [2]uint16{tagOrientation, 6})[2:]...))), 1},
		{"TIFF shorter than its header", withSegments(plain, exif([]byte("II*\x00"))), 1},
		{"IFD offset past the end", withSegments(plain, exif(append(tiff("II")[:4], 0xFF, 0, 0, 0))), 1},
		{"IFD offset inside the header", withSegments(plain, exif(append(tiff("II")[:4], 2, 0, 0, 0, 0, 0))), 1},
		{"entry count past the end", withSegments(plain, exif(tiff("II", [2]uint16{tagOrientation, 6})[:14])), 1},
		{"APP1 that is not EXIF", withSegments(plain, segment(0xE1, []byte("http://ns.adobe.com/xap/1.0/\x00"))), 1},
		{"EXIF after the image data starts", append(append([]byte{}, plain[:len(plain)-2]...), exif(tiff("II", [2]uint16{tagOrientation, 6}))...), 1},
		{"segment longer than the file", []byte{0xFF, 0xD8, 0xFF, 0xE1, 0x7F, 0xFF, 'E', 'x'}, 1},
		{"segment length below 2", []byte{0xFF, 0xD8, 0xFF, 0xE1, 0x00, 0x01, 0, 0}, 1},
		{"garbage instead of a marker", []byte{0xFF, 0xD8, 0x00, 0xE1, 0x00, 0x10}, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			testx.AssertEqual(t, orientation(tt.data), tt.want)
		})
	}
}

// letters is a stored 3×2 image whose pixels are told apart by their red
// channel: a b c on top, d e f below.
func letters() *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, 3, 2))
	for i, r := range "abcdef" {
		img.SetRGBA(i%3, i/3, color.RGBA{R: uint8(r), A: 255}) // #nosec G115 -- ASCII
	}
	return img
}

// read is img's pixels as letters, rows joined with "/".
func read(img *image.RGBA) string {
	b := img.Bounds()
	rows := make([]string, 0, b.Dy())
	for y := b.Min.Y; y < b.Max.Y; y++ {
		var row strings.Builder
		for x := b.Min.X; x < b.Max.X; x++ {
			row.WriteByte(img.RGBAAt(x, y).R)
		}
		rows = append(rows, row.String())
	}
	return strings.Join(rows, "/")
}

// The eight EXIF orientations, as the EXIF specification draws them for
// the stored image "abc/def".
func TestOrient(t *testing.T) {
	tests := []struct {
		o    int
		want string
	}{
		{1, "abc/def"},
		{2, "cba/fed"},       // mirrored
		{3, "fed/cba"},       // turned 180°
		{4, "def/abc"},       // flipped
		{5, "ad/be/cf"},      // transposed
		{6, "da/eb/fc"},      // turned 90° clockwise
		{7, "fc/eb/da"},      // transversed
		{8, "cf/be/ad"},      // turned 90° counter-clockwise
		{0, "abc/def"},       // not an orientation: as stored
		{9, "abc/def"},       // not an orientation: as stored
		{-1, "abc/def"},      // not an orientation: as stored
		{1 << 10, "abc/def"}, // not an orientation: as stored
	}
	for _, tt := range tests {
		got := orient(letters(), tt.o)
		testx.AssertEqual(t, read(got), tt.want, "orientation %d", tt.o)
		testx.AssertEqual(t, swapsSides(tt.o), tt.o >= 5, "swapsSides(%d)", tt.o)
	}
	// An image whose bounds do not start at 0,0 turns the same way.
	sub := letters()
	shifted := image.NewRGBA(image.Rect(10, 20, 13, 22))
	copy(shifted.Pix, sub.Pix)
	testx.AssertEqual(t, read(orient(shifted, 6)), "da/eb/fc")
}

// halves is a stored w×h JPEG whose top half is red and bottom half blue,
// with orientation o in its EXIF (none for 0).
func halves(t *testing.T, w, h, o int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		c := color.RGBA{R: 220, A: 255}
		if y >= h/2 {
			c = color.RGBA{B: 220, A: 255}
		}
		for x := range w {
			img.SetRGBA(x, y, c)
		}
	}
	jpg := encodeJPEG(t, img)
	if o == 0 {
		return jpg
	}
	return withSegments(jpg, exif(tiff("II", [2]uint16{tagOrientation, uint16(o)}))) // #nosec G115 -- 1..8
}

func isRed(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return r > 0x9000 && g < 0x5000 && b < 0x5000
}

func isBlue(c color.Color) bool {
	r, g, b, _ := c.RGBA()
	return b > 0x9000 && r < 0x5000 && g < 0x5000
}

// The variants are turned as displayed, and the DISPLAYED width decides
// which widths are made: a 1000×600 photo shot in portrait (orientation 6)
// is 600 wide on screen, so it gets 400w and 600w, never 800w.
func TestResize_TurnsAsTheEXIFOrientationSays(t *testing.T) {
	tests := []struct {
		name          string
		o             int
		wantSizes     string
		redAt, blueAt [2]float64 // where each half ends up, as fractions of the variant
	}{
		{name: "no EXIF", o: 0, wantSizes: "400x240,800x480", redAt: [2]float64{0.5, 0.1}, blueAt: [2]float64{0.5, 0.9}},
		{name: "1: as stored", o: 1, wantSizes: "400x240,800x480", redAt: [2]float64{0.5, 0.1}, blueAt: [2]float64{0.5, 0.9}},
		{name: "3: upside down", o: 3, wantSizes: "400x240,800x480", redAt: [2]float64{0.5, 0.9}, blueAt: [2]float64{0.5, 0.1}},
		{name: "6: portrait, turned clockwise", o: 6, wantSizes: "400x666,600x1000", redAt: [2]float64{0.9, 0.5}, blueAt: [2]float64{0.1, 0.5}},
		{name: "8: portrait, turned counter-clockwise", o: 8, wantSizes: "400x666,600x1000", redAt: [2]float64{0.1, 0.5}, blueAt: [2]float64{0.9, 0.5}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resize(bytes.NewReader(halves(t, 1000, 600, tt.o)), Widths, 24_000_000)
			testx.AssertNoError(t, err)
			sizes := make([]string, 0, len(got))
			for _, v := range got {
				img := decodeVariant(t, v)
				sizes = append(sizes, strconv.Itoa(v.Width)+"x"+strconv.Itoa(v.Height))
				at := func(f [2]float64) color.Color {
					return img.At(int(f[0]*float64(v.Width)), int(f[1]*float64(v.Height)))
				}
				testx.AssertTrue(t, isRed(at(tt.redAt)), "%dpx: the red half is not at %v", v.Width, tt.redAt)
				testx.AssertTrue(t, isBlue(at(tt.blueAt)), "%dpx: the blue half is not at %v", v.Width, tt.blueAt)
			}
			testx.AssertEqual(t, strings.Join(sizes, ","), tt.wantSizes)
		})
	}
}

// A broken EXIF block never fails the resize: the photo is used as stored.
func TestResize_BadEXIFIsIgnored(t *testing.T) {
	plain := halves(t, 1000, 600, 0)
	for name, seg := range map[string][]byte{
		"truncated TIFF":   exif([]byte("MM\x00*\x00\x00")),
		"IFD past the end": exif(append(tiff("MM")[:4], 0x7F, 0, 0, 0)),
		"orientation 42":   exif(tiff("MM", [2]uint16{tagOrientation, 42})),
	} {
		t.Run(name, func(t *testing.T) {
			got, err := Resize(bytes.NewReader(withSegments(plain, seg)), Widths, 24_000_000)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(got), 2)
			testx.AssertEqual(t, got[1].Width, 800)
			testx.AssertEqual(t, got[1].Height, 480)
			img := decodeVariant(t, got[1])
			testx.AssertTrue(t, isRed(img.At(400, 20)), "as stored: red on top")
		})
	}
}
