-- name: ListCategories :many
-- Every category. The service sorts them for the response.
SELECT id, parent_id, name, slug
FROM categories;

-- name: GetCategoryIDBySlug :one
-- Resolves the ?category= filter; no row means the slug is unknown.
SELECT id
FROM categories
WHERE slug = @slug;
