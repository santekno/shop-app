package imaging

import (
	"encoding/binary"
	"image"
)

// Phone cameras save a photo the way the sensor saw it and write how to
// turn it in the EXIF Orientation tag (1–8). Browsers turn the original
// for display, but the re-encoded variants carry no EXIF, so the worker
// turns them itself (ADR 0007). Only JPEGs carry the tag in practice.

// orientation is the EXIF Orientation of a JPEG, or 1 (as stored) when
// data is not a JPEG, has no EXIF, or the tag is missing or invalid. It
// reads the APP1 segment only: no library, a few bounds-checked lookups.
func orientation(data []byte) int {
	if len(data) < 4 || data[0] != 0xFF || data[1] != 0xD8 {
		return 1
	}
	for i := 2; i+4 <= len(data); {
		if data[i] != 0xFF {
			return 1
		}
		marker := data[i+1]
		size := int(binary.BigEndian.Uint16(data[i+2:]))
		if marker == 0xDA || size < 2 || i+2+size > len(data) {
			return 1 // the image data starts: no EXIF before it
		}
		segment := data[i+4 : i+2+size]
		if marker == 0xE1 && len(segment) > 6 && string(segment[:6]) == "Exif\x00\x00" {
			return tiffOrientation(segment[6:])
		}
		i += 2 + size
	}
	return 1
}

// tiffOrientation reads tag 0x0112 from the first IFD of a TIFF block.
func tiffOrientation(tiff []byte) int {
	if len(tiff) < 8 {
		return 1
	}
	var order binary.ByteOrder
	switch string(tiff[:2]) {
	case "II":
		order = binary.LittleEndian
	case "MM":
		order = binary.BigEndian
	default:
		return 1
	}
	ifd := int(order.Uint32(tiff[4:]))
	if ifd < 8 || ifd+2 > len(tiff) {
		return 1
	}
	entries := int(order.Uint16(tiff[ifd:]))
	for e := range entries {
		at := ifd + 2 + e*12
		if at+12 > len(tiff) {
			return 1
		}
		if order.Uint16(tiff[at:]) == 0x0112 {
			if v := int(order.Uint16(tiff[at+8:])); v >= 1 && v <= 8 {
				return v
			}
			return 1
		}
	}
	return 1
}

// swapsSides reports whether orientation o turns the image a quarter, so
// its displayed width is its stored height.
func swapsSides(o int) bool { return o >= 5 }

// orient turns src, as stored, into how orientation o says to display it.
// It runs on the already-scaled variant, which is small.
func orient(src *image.RGBA, o int) *image.RGBA {
	if o <= 1 || o > 8 {
		return src
	}
	sb := src.Bounds()
	w, h := sb.Dx(), sb.Dy()
	if swapsSides(o) {
		w, h = h, w
	}
	dst := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			var sx, sy int
			switch o {
			case 2: // mirrored
				sx, sy = w-1-x, y
			case 3: // turned 180°
				sx, sy = w-1-x, h-1-y
			case 4: // flipped
				sx, sy = x, h-1-y
			case 5: // transposed
				sx, sy = y, x
			case 6: // turned 90° clockwise to display
				sx, sy = y, w-1-x
			case 7: // transversed
				sx, sy = h-1-y, w-1-x
			case 8: // turned 90° counter-clockwise to display
				sx, sy = h-1-y, x
			}
			dst.SetRGBA(x, y, src.RGBAAt(sb.Min.X+sx, sb.Min.Y+sy))
		}
	}
	return dst
}
