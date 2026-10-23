-- Shipping addresses. Every query takes the owner's user_id as well as the
-- address id: another user's address is simply not found (404), never
-- forbidden (403), so its existence is not revealed either. Served by
-- addresses_user_id_idx and the primary key.

-- name: ListAddresses :many
-- The default first, then the newest.
SELECT id, label, recipient_name, phone, street, city, province, postal_code, is_default, created_at, updated_at
FROM addresses
WHERE user_id = @user_id
ORDER BY is_default DESC, created_at DESC, id DESC;

-- name: GetAddress :one
SELECT id, label, recipient_name, phone, street, city, province, postal_code, is_default, created_at, updated_at
FROM addresses
WHERE id = @id AND user_id = @user_id;

-- name: CountAddresses :one
SELECT count(*) FROM addresses WHERE user_id = @user_id;

-- name: InsertAddress :one
INSERT INTO addresses (id, user_id, label, recipient_name, phone, street, city, province, postal_code, is_default)
VALUES (@id, @user_id, @label, @recipient_name, @phone, @street, @city, @province, @postal_code, @is_default)
RETURNING id, label, recipient_name, phone, street, city, province, postal_code, is_default, created_at, updated_at;

-- name: UpdateAddress :one
-- A partial update: a NULL argument keeps the column.
UPDATE addresses
SET label          = COALESCE(sqlc.narg('label'), label),
    recipient_name = COALESCE(sqlc.narg('recipient_name'), recipient_name),
    phone          = COALESCE(sqlc.narg('phone'), phone),
    street         = COALESCE(sqlc.narg('street'), street),
    city           = COALESCE(sqlc.narg('city'), city),
    province       = COALESCE(sqlc.narg('province'), province),
    postal_code    = COALESCE(sqlc.narg('postal_code'), postal_code),
    is_default     = COALESCE(sqlc.narg('is_default'), is_default),
    updated_at     = now()
WHERE id = @id AND user_id = @user_id
RETURNING id, label, recipient_name, phone, street, city, province, postal_code, is_default, created_at, updated_at;

-- name: ClearDefaultAddress :exec
-- Before another address becomes the default, in the same transaction.
UPDATE addresses SET is_default = false, updated_at = now()
WHERE user_id = @user_id AND is_default;

-- name: DeleteAddress :one
-- Returns whether the deleted address was the default.
DELETE FROM addresses
WHERE id = @id AND user_id = @user_id
RETURNING is_default;

-- name: PromoteNewestAddress :exec
-- After the default was deleted: the newest remaining address becomes the
-- default. No rows when none is left.
UPDATE addresses SET is_default = true, updated_at = now()
WHERE id = (
    SELECT a.id FROM addresses a
    WHERE a.user_id = @user_id
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT 1
);

-- name: DeleteUserAddresses :exec
-- Account deletion.
DELETE FROM addresses WHERE user_id = @user_id;
