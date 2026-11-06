-- The home screen's banner carousel (Bab 14). Banners are written by the
-- seed or by hand; the API only reads them.

-- name: ListActiveBanners :many
-- Active banners in carousel order, served by banners_active_position_idx.
SELECT id, title, subtitle, cta_label, link_category_slug, background_color
FROM banners
WHERE is_active
ORDER BY position, id;
