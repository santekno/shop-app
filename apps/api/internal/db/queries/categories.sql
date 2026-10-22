-- name: ListCategories :many
-- Every category. The service sorts them for the response.
SELECT id, parent_id, name, slug
FROM categories;

-- name: ListCategoryTreeIDs :many
-- What ?category= covers: the category with slug and its children (two
-- levels at most, so one level of children is all). No rows means the slug
-- is unknown.
SELECT c.id
FROM categories c
JOIN categories t ON c.id = t.id OR c.parent_id = t.id
WHERE t.slug = @slug;
