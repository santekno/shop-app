package imaging

import (
	"bytes"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"

	"github.com/santekno/sdk/testx"
)

// gradient is a w×h image that is not one flat colour.
func gradient(w, h int) *image.RGBA {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			img.Set(x, y, color.RGBA{R: uint8(x % 256), G: uint8(y % 256), B: 128, A: 255}) // #nosec G115 -- test pattern
		}
	}
	return img
}

func encodePNG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	testx.AssertNoError(t, png.Encode(&b, img))
	return b.Bytes()
}

func encodeJPEG(t *testing.T, img image.Image) []byte {
	t.Helper()
	var b bytes.Buffer
	testx.AssertNoError(t, jpeg.Encode(&b, img, &jpeg.Options{Quality: 90}))
	return b.Bytes()
}

// pngHeader is a PNG's signature and IHDR chunk only, for a w×h RGBA
// image: enough for image.DecodeConfig, with no pixel data at all.
func pngHeader(w, h uint32) []byte {
	var b bytes.Buffer
	b.WriteString("\x89PNG\r\n\x1a\n")
	ihdr := make([]byte, 13)
	binary.BigEndian.PutUint32(ihdr[0:], w)
	binary.BigEndian.PutUint32(ihdr[4:], h)
	ihdr[8], ihdr[9] = 8, 6 // 8-bit RGBA
	chunk := append([]byte("IHDR"), ihdr...)
	_ = binary.Write(&b, binary.BigEndian, uint32(13)) // the IHDR length
	b.Write(chunk)
	_ = binary.Write(&b, binary.BigEndian, crc32.ChecksumIEEE(chunk))
	return b.Bytes()
}

// decodeVariant decodes v's JPEG and checks it is v.Width × v.Height.
func decodeVariant(t *testing.T, v Variant) image.Image {
	t.Helper()
	img, err := jpeg.Decode(bytes.NewReader(v.JPEG))
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, img.Bounds().Dx(), v.Width)
	testx.AssertEqual(t, img.Bounds().Dy(), v.Height)
	return img
}

func TestResize_MakesEveryWidthKeepingTheAspectRatio(t *testing.T) {
	tests := []struct {
		name   string
		encode func(*testing.T, image.Image) []byte
	}{
		{name: "png", encode: encodePNG},
		{name: "jpeg", encode: encodeJPEG},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resize(bytes.NewReader(tt.encode(t, gradient(1000, 500))), Widths, 24_000_000)
			testx.AssertNoError(t, err)
			testx.AssertEqual(t, len(got), 2)
			if len(got) != 2 {
				return
			}
			testx.AssertEqual(t, [2]int{got[0].Width, got[0].Height}, [2]int{400, 200})
			testx.AssertEqual(t, [2]int{got[1].Width, got[1].Height}, [2]int{800, 400})
			for _, v := range got {
				decodeVariant(t, v)
			}
		})
	}
}

func TestResize_SmallImageIsNeverUpscaled(t *testing.T) {
	got, err := Resize(bytes.NewReader(encodePNG(t, gradient(300, 200))), Widths, 24_000_000)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 1)
	if len(got) != 1 {
		return
	}
	testx.AssertEqual(t, [2]int{got[0].Width, got[0].Height}, [2]int{300, 200})
	decodeVariant(t, got[0])
}

func TestResize_KeepsAtLeastOnePixelOfHeight(t *testing.T) {
	// A 1000×1 strip scaled to 400 wide would be 0.4 px high.
	got, err := Resize(bytes.NewReader(encodePNG(t, gradient(1000, 1))), []int{400}, 24_000_000)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 1)
	testx.AssertEqual(t, got[0].Height, 1)
	decodeVariant(t, got[0])
}

func TestTargetWidths(t *testing.T) {
	tests := []struct {
		width  int
		widths []int
		want   []int
	}{
		{width: 1000, widths: Widths, want: []int{400, 800}},
		{width: 800, widths: Widths, want: []int{400, 800}}, // not 400, 800, 800
		{width: 801, widths: Widths, want: []int{400, 800}},
		{width: 799, widths: Widths, want: []int{400, 799}},
		{width: 600, widths: Widths, want: []int{400, 600}},
		{width: 400, widths: Widths, want: []int{400}},
		{width: 300, widths: Widths, want: []int{300}},
		{width: 1, widths: Widths, want: []int{1}},
		{width: 1000, widths: nil, want: nil},
		{width: 300, widths: []int{}, want: nil},
	}
	for _, tt := range tests {
		got := targetWidths(tt.width, tt.widths)
		testx.AssertEqual(t, len(got), len(tt.want), "width %d: %v", tt.width, got)
		for i := range min(len(got), len(tt.want)) {
			testx.AssertEqual(t, got[i], tt.want[i], "width %d: %v", tt.width, got)
		}
		for _, w := range got {
			testx.AssertTrue(t, w <= tt.width, "width %d upscaled to %d", tt.width, w)
		}
	}
}

func TestResize_RefusesWhatIsNotAnImage(t *testing.T) {
	pngBytes := encodePNG(t, gradient(200, 100))
	tests := []struct {
		name string
		data []byte
	}{
		{name: "empty", data: nil},
		{name: "text", data: []byte("hello, this is not an image\n")},
		{name: "random bytes", data: bytes.Repeat([]byte{0x13, 0x37, 0xC0, 0xDE}, 64)},
		{name: "gif (not an accepted format)", data: []byte("GIF89a\x01\x00\x01\x00\x00\x00\x00;")},
		{name: "png cut after its header", data: pngBytes[:60]},
		{name: "png header only", data: pngHeader(10, 10)},
		{name: "jpeg magic then garbage", data: append([]byte{0xFF, 0xD8, 0xFF, 0xE0}, bytes.Repeat([]byte{0x01}, 32)...)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := Resize(bytes.NewReader(tt.data), Widths, 24_000_000)
			testx.AssertTrue(t, errors.Is(err, ErrUndecodable), "err = %v", err)
			testx.AssertEqual(t, len(got), 0)
		})
	}
}

func TestResize_MaxPixelsIsCheckedBeforeDecoding(t *testing.T) {
	t.Run("a real image over the limit", func(t *testing.T) {
		got, err := Resize(bytes.NewReader(encodePNG(t, gradient(100, 100))), Widths, 5000)
		testx.AssertTrue(t, errors.Is(err, ErrUndecodable), "err = %v", err)
		testx.AssertContains(t, err.Error(), "100x100 pixels")
		testx.AssertEqual(t, len(got), 0)
	})
	t.Run("exactly at the limit is decoded", func(t *testing.T) {
		got, err := Resize(bytes.NewReader(encodePNG(t, gradient(100, 50))), Widths, 5000)
		testx.AssertNoError(t, err)
		testx.AssertEqual(t, len(got), 1)
	})
	t.Run("a header promising a huge bitmap is refused by its size", func(t *testing.T) {
		// No pixel data follows: decoding it would fail with a read error,
		// so the pixel count in the message proves nothing was decoded.
		_, err := Resize(bytes.NewReader(pngHeader(50000, 50000)), Widths, 24_000_000)
		testx.AssertTrue(t, errors.Is(err, ErrUndecodable), "err = %v", err)
		testx.AssertContains(t, err.Error(), "50000x50000 pixels")
	})
}

// exifJPEG is a JPEG carrying an EXIF APP1 segment with a GPS marker
// right after SOI, as a phone writes it.
func exifJPEG(t *testing.T, marker string) []byte {
	t.Helper()
	plain := encodeJPEG(t, gradient(1000, 750))
	payload := append([]byte("Exif\x00\x00"), []byte(marker)...)
	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2)) // #nosec G115 -- small
	seg = append(seg, payload...)
	out := append([]byte{}, plain[:2]...)
	out = append(out, seg...)
	return append(out, plain[2:]...)
}

func TestResize_DropsMetadata(t *testing.T) {
	const marker = "GPSLatitude=-6.2088;GPSLongitude=106.8456"
	in := exifJPEG(t, marker)
	testx.AssertTrue(t, bytes.Contains(in, []byte("Exif\x00\x00")), "the input has EXIF")
	_, err := jpeg.DecodeConfig(bytes.NewReader(in))
	testx.AssertNoError(t, err)

	got, err := Resize(bytes.NewReader(in), Widths, 24_000_000)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 2)
	for _, v := range got {
		testx.AssertFalse(t, bytes.Contains(v.JPEG, []byte("Exif")), "%dpx keeps EXIF", v.Width)
		testx.AssertFalse(t, bytes.Contains(v.JPEG, []byte{0xFF, 0xE1}), "%dpx has an APP1 segment", v.Width)
		testx.AssertFalse(t, bytes.Contains(v.JPEG, []byte(marker)), "%dpx keeps the GPS position", v.Width)
		testx.AssertTrue(t, bytes.HasPrefix(v.JPEG, []byte{0xFF, 0xD8}), "a JPEG")
		decodeVariant(t, v)
	}
}

func TestResize_TransparencyBecomesWhite(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 500, 500))
	for y := range 500 {
		for x := range 500 {
			if x < 250 {
				img.SetNRGBA(x, y, color.NRGBA{R: 255, A: 0}) // invisible red
			} else {
				img.SetNRGBA(x, y, color.NRGBA{B: 255, A: 255})
			}
		}
	}

	got, err := Resize(bytes.NewReader(encodePNG(t, img)), Widths, 24_000_000)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 2, "500px: 400 and 500")
	out := decodeVariant(t, got[0])
	r, g, b, _ := out.At(40, 200).RGBA()
	testx.AssertTrue(t, r>>8 >= 245 && g>>8 >= 245 && b>>8 >= 245, "transparent pixel is %d,%d,%d, want white", r>>8, g>>8, b>>8)
	r, g, b, _ = out.At(360, 200).RGBA()
	testx.AssertTrue(t, b>>8 >= 230 && r>>8 <= 25 && g>>8 <= 25, "opaque blue is %d,%d,%d", r>>8, g>>8, b>>8)
}

// webp1x1 is a 1×1 lossless WebP (the libwebp test image).
const webp1x1 = "UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="

func TestResize_WebP(t *testing.T) {
	data, err := base64.StdEncoding.DecodeString(webp1x1)
	testx.AssertNoError(t, err)
	testx.AssertTrue(t, strings.HasPrefix(string(data), "RIFF"))

	got, err := Resize(bytes.NewReader(data), Widths, 24_000_000)

	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 1)
	if len(got) == 1 {
		testx.AssertEqual(t, [2]int{got[0].Width, got[0].Height}, [2]int{1, 1})
		decodeVariant(t, got[0])
	}
}

func TestResize_EncodesAtTheConfiguredQuality(t *testing.T) {
	// A noisy photo-like image: the output must be far smaller than a
	// quality-100 encode of the same pixels, and much larger than a
	// quality-10 one (so the quality is neither maximal nor minimal).
	src := gradient(400, 300)
	for i := range src.Pix {
		src.Pix[i] ^= uint8(i * 7919 % 251) // #nosec G115 -- noise
	}
	got, err := Resize(bytes.NewReader(encodePNG(t, src)), []int{400}, 24_000_000)
	testx.AssertNoError(t, err)
	testx.AssertEqual(t, len(got), 1)
	size := func(q int) int {
		var b bytes.Buffer
		testx.AssertNoError(t, jpeg.Encode(&b, decodeVariant(t, got[0]), &jpeg.Options{Quality: q}))
		return b.Len()
	}
	testx.AssertEqual(t, Quality, 82)
	testx.AssertTrue(t, len(got[0].JPEG) < size(100), "%d bytes", len(got[0].JPEG))
	testx.AssertTrue(t, len(got[0].JPEG) > size(10), "%d bytes", len(got[0].JPEG))
}
