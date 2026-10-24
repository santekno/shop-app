package product

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/santekno/sdk/errx"
	"github.com/santekno/sdk/uuidx"

	"github.com/santekno/shop-app/apps/api/internal/httpapi"
)

// The codes the image endpoints add (see api/openapi.yaml).
const (
	CodeStorageDisabled = "STORAGE_DISABLED"
	CodeImageLimit      = "IMAGE_LIMIT_REACHED"
	CodeUploadMissing   = "UPLOAD_MISSING"
	CodeUploadInvalid   = "UPLOAD_INVALID"
)

// Images is what the image handlers need from the ImageService.
type Images interface {
	StartUpload(ctx context.Context, productID, contentType string, size int32) (Upload, error)
	Confirm(ctx context.Context, productID, imageID, alt string) (Image, error)
	Delete(ctx context.Context, productID, imageID string) error
}

// WithImages makes h serve the image endpoints with images, and write
// image URLs with publicURL (the bucket's public base plus the key). It
// returns h. Without it the image endpoints answer 503 STORAGE_DISABLED.
func (h *Handler) WithImages(images Images, publicURL func(key string) string) *Handler {
	h.images, h.publicURL = images, publicURL
	return h
}

// imageRoutes registers the admin image routes (under /v1/admin).
func (h *Handler) imageRoutes(r chi.Router) {
	r.Post("/products/{id}/images/uploads", h.StartImageUpload)
	r.Post("/products/{id}/images/{image_id}/confirm", h.ConfirmImage)
	r.Delete("/products/{id}/images/{image_id}", h.DeleteImage)
}

// uploadBody is the body of POST /v1/admin/products/{id}/images/uploads.
type uploadBody struct {
	ContentType string `json:"content_type" validate:"required,oneof=image/jpeg image/png image/webp"`
	SizeBytes   int32  `json:"size_bytes" validate:"min=1,max=5242880"`
}

// StartImageUpload serves POST /v1/admin/products/{id}/images/uploads:
// 201 with the new pending image and a presigned PUT for its file.
func (h *Handler) StartImageUpload(w http.ResponseWriter, r *http.Request) {
	productID, ok := pathID(w, r, "id", ErrNotFound)
	if !ok {
		return
	}
	var body uploadBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(&body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if h.images == nil {
		httpapi.Error(w, r, toImageHTTPError(ErrStorageDisabled))
		return
	}
	up, err := h.images.StartUpload(r.Context(), productID, body.ContentType, body.SizeBytes)
	if err != nil {
		httpapi.Error(w, r, toImageHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusCreated, dataResponse{Data: uploadJSON{
		Image: h.toAdminImageJSON(up.Image),
		Upload: presignedJSON{
			Method: http.MethodPut, URL: up.Upload.URL, Headers: up.Upload.Headers, ExpiresAt: up.Upload.ExpiresAt.UTC(),
		},
	}})
}

// confirmBody is the body of POST …/images/{image_id}/confirm.
type confirmBody struct {
	Alt string `json:"alt" validate:"max=200"`
}

// ConfirmImage serves POST /v1/admin/products/{id}/images/{image_id}/confirm:
// 200 with the image once its file checks out.
func (h *Handler) ConfirmImage(w http.ResponseWriter, r *http.Request) {
	productID, imageID, ok := imagePath(w, r)
	if !ok {
		return
	}
	var body confirmBody
	if err := httpapi.DecodeJSON(w, r, &body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if err := h.validator.Struct(&body); err != nil {
		httpapi.Error(w, r, err)
		return
	}
	if !httpapi.ValidText(body.Alt) {
		httpapi.Error(w, r, httpapi.ValidationError("invalid request", map[string]any{"alt": httpapi.InvalidTextMessage}))
		return
	}
	if h.images == nil {
		httpapi.Error(w, r, toImageHTTPError(ErrStorageDisabled))
		return
	}
	img, err := h.images.Confirm(r.Context(), productID, imageID, body.Alt)
	if err != nil {
		httpapi.Error(w, r, toImageHTTPError(err))
		return
	}
	httpapi.JSON(w, r, http.StatusOK, dataResponse{Data: h.toAdminImageJSON(img)})
}

// DeleteImage serves DELETE /v1/admin/products/{id}/images/{image_id}: 204.
func (h *Handler) DeleteImage(w http.ResponseWriter, r *http.Request) {
	productID, imageID, ok := imagePath(w, r)
	if !ok {
		return
	}
	if h.images == nil {
		httpapi.Error(w, r, toImageHTTPError(ErrStorageDisabled))
		return
	}
	if err := h.images.Delete(r.Context(), productID, imageID); err != nil {
		httpapi.Error(w, r, toImageHTTPError(err))
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// pathID reads the UUID URL parameter name; anything else is answered
// like notFound, without a query.
func pathID(w http.ResponseWriter, r *http.Request, name string, notFound error) (string, bool) {
	id := chi.URLParam(r, name)
	if !uuidx.IsValidUUID(id) {
		httpapi.Error(w, r, toImageHTTPError(notFound))
		return "", false
	}
	return id, true
}

func imagePath(w http.ResponseWriter, r *http.Request) (productID, imageID string, ok bool) {
	if productID, ok = pathID(w, r, "id", ErrImageNotFound); !ok {
		return "", "", false
	}
	imageID, ok = pathID(w, r, "image_id", ErrImageNotFound)
	return productID, imageID, ok
}

func toImageHTTPError(err error) error {
	var invalid *UploadInvalidError
	switch {
	case errors.Is(err, ErrStorageDisabled):
		return errx.New(CodeStorageDisabled, "image storage is not configured on this server").
			WithHTTPStatus(http.StatusServiceUnavailable)
	case errors.Is(err, ErrImageNotFound):
		return httpapi.NotFoundError("image not found")
	case errors.Is(err, ErrImageLimit):
		return errx.New(CodeImageLimit, "this product has the most images it may have; delete one first").
			WithHTTPStatus(http.StatusConflict).WithDetails(map[string]any{"max": MaxImagesPerProduct})
	case errors.Is(err, ErrUploadMissing):
		return errx.New(CodeUploadMissing, "upload the file to the presigned URL before confirming").
			WithHTTPStatus(http.StatusConflict)
	case errors.As(err, &invalid):
		return errx.New(CodeUploadInvalid, "the uploaded file is not the declared image; start a new upload").
			WithHTTPStatus(http.StatusUnprocessableEntity).WithDetails(map[string]any{"reason": invalid.Reason})
	default:
		return toHTTPError(err)
	}
}

// imageURL is the public URL of key.
func (h *Handler) imageURL(key string) string {
	if h.publicURL == nil {
		return key
	}
	return h.publicURL(key)
}

// imageJSON is ProductImage in api/openapi.yaml: a photo as the
// storefront shows it.
type imageJSON struct {
	ID     string `json:"id"`
	URL    string `json:"url"`
	Alt    string `json:"alt"`
	Width  int32  `json:"width"`
	Height int32  `json:"height"`
}

// adminImageJSON is AdminProductImage: every image, with its status.
type adminImageJSON struct {
	ID          string    `json:"id"`
	Status      string    `json:"status"`
	Position    int16     `json:"position"`
	Alt         string    `json:"alt"`
	ContentType string    `json:"content_type"`
	SizeBytes   int32     `json:"size_bytes"`
	URL         *string   `json:"url"` // null until confirmed
	Width       *int32    `json:"width"`
	Height      *int32    `json:"height"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type presignedJSON struct {
	Method    string            `json:"method"`
	URL       string            `json:"url"`
	Headers   map[string]string `json:"headers"`
	ExpiresAt time.Time         `json:"expires_at"`
}

type uploadJSON struct {
	Image  adminImageJSON `json:"image"`
	Upload presignedJSON  `json:"upload"`
}

func (h *Handler) toImagesJSON(images []Image) []imageJSON {
	out := make([]imageJSON, 0, len(images))
	for _, img := range images {
		out = append(out, imageJSON{
			ID: img.ID, URL: h.imageURL(img.OriginalKey), Alt: img.Alt, Width: img.Width, Height: img.Height,
		})
	}
	return out
}

func (h *Handler) toAdminImageJSON(img Image) adminImageJSON {
	out := adminImageJSON{
		ID: img.ID, Status: img.Status, Position: img.Position, Alt: img.Alt, ContentType: img.ContentType,
		SizeBytes: img.SizeBytes, CreatedAt: img.CreatedAt.UTC(), UpdatedAt: img.UpdatedAt.UTC(),
	}
	if img.Status != ImagePendingUpload {
		url, w, ht := h.imageURL(img.OriginalKey), img.Width, img.Height
		out.URL, out.Width, out.Height = &url, &w, &ht
	}
	return out
}

func (h *Handler) toAdminImagesJSON(images []Image) []adminImageJSON {
	out := make([]adminImageJSON, 0, len(images))
	for _, img := range images {
		out = append(out, h.toAdminImageJSON(img))
	}
	return out
}
