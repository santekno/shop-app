-- Sign-in identities (Google). Accounts are found by (provider, subject),
-- served by user_identities_provider_subject_key; never by email.

-- name: GetUserByIdentity :one
SELECT u.id, u.email, u.password_hash, u.name, u.phone, u.role, u.email_verified_at, u.created_at, u.updated_at
FROM user_identities i
JOIN users u ON u.id = i.user_id
WHERE i.provider = @provider AND i.subject = @subject AND u.anonymized_at IS NULL;

-- name: InsertUserIdentity :exec
INSERT INTO user_identities (id, user_id, provider, subject)
VALUES (@id, @user_id, @provider, @subject);

-- name: DeleteUserIdentities :exec
-- Account deletion. Served by user_identities_user_provider_key.
DELETE FROM user_identities WHERE user_id = @user_id;
